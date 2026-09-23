// /app/api/payments/flutterwave/initialize/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/database/connection';
import { Payment, TicketType, Order, Event, User, DiscountCode } from '@/lib/database/models';
import mongoose from 'mongoose';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('📝 Flutterwave Initialize Request body:', body);

    const {
      eventId,
      ticketTypeId,
      quantity,
      amount,
      email,
      userName,
      discountCode,
      discountPercent,
      discountAmount,
      isGuest,
    } = body;

    // Validate required fields
    if (!eventId || !ticketTypeId || !quantity || !amount || !email) {
      console.error('❌ Missing required fields:', { eventId, ticketTypeId, quantity, amount, email });
      return NextResponse.json({ 
        error: 'Missing required fields',
        details: { eventId, ticketTypeId, quantity, amount, email }
      }, { status: 400 });
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format:', email);
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // ✅ FIX: Validate eventId is a real ObjectId before it ever touches the DB.
    // Without this, a malformed eventId falls through to Event.findById(), throws,
    // and gets reported as a generic 500 instead of a clean 400.
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      console.error('❌ Invalid eventId format:', eventId);
      return NextResponse.json({ error: 'Invalid event ID format' }, { status: 400 });
    }

    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // 1. Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        email,
        loginMethod: 'email',
        // ✅ FIX: crypto.randomUUID() instead of Date.now() — two guest checkouts
        // landing in the same millisecond could previously collide on a unique
        // privyId index and throw a 500 instead of completing checkout.
        privyId: `guest-${crypto.randomUUID()}`,
        isOrganizer: false,
        isProfileComplete: true,
      });
      console.log(`📝 Created new user: ${user._id} for email: ${email}`);
    } else {
      console.log(`📝 Found existing user: ${user._id} for email: ${email}`);
    }

    // 2. Get event data
    const event = await Event.findById(eventId).lean();
    if (!event) {
      console.error('❌ Event not found:', eventId);
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    console.log(`📋 Found event: ${event.title}`);

    // 3. Determine ticket type
    let ticketPrice = amount / quantity;
    let ticketName = 'Ticket';
    let isVirtual = false;
    let realTicketTypeId = null;
    let ticketType = null;

    const isVirtualTicket = ticketTypeId.toString().startsWith('virtual_');

    if (!isVirtualTicket && mongoose.Types.ObjectId.isValid(ticketTypeId)) {
      realTicketTypeId = new mongoose.Types.ObjectId(ticketTypeId);

      const existingTicketType = await TicketType.findById(realTicketTypeId);
      if (!existingTicketType) {
        console.error('❌ Ticket type not found:', ticketTypeId);
        return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 });
      }

      // ✅ FIX: Atomically reserve the tickets instead of read-then-write.
      // The old pattern (read currentSupply, check availability, then save)
      // had a race window: two concurrent requests could both read "1 left"
      // and both pass the check before either save() landed, overselling
      // the last ticket(s). This single findOneAndUpdate only succeeds if
      // there is still enough room at the exact moment of the update.
      ticketType = await TicketType.findOneAndUpdate(
        {
          _id: realTicketTypeId,
          $expr: { $lte: [{ $add: ['$currentSupply', quantity] }, '$maxSupply'] },
        },
        { $inc: { currentSupply: quantity } },
        { new: true }
      );

      if (!ticketType) {
        const available = existingTicketType.maxSupply - existingTicketType.currentSupply;
        return NextResponse.json(
          { error: `Only ${Math.max(0, available)} tickets available for ${existingTicketType.name}` },
          { status: 400 }
        );
      }

      ticketPrice = ticketType.price;
      ticketName = ticketType.name;
    } else {
      isVirtual = true;
      ticketPrice = event.isFree ? 0 : event.price;
      ticketName = event.isFree ? 'Free Admission' : 'General Admission';
      realTicketTypeId = event._id;
    }

    const originalAmount = ticketPrice * quantity;
    let finalAmount = originalAmount;
    let discountInfo = null;

    // 4. Apply discount
    if (discountCode) {
      const discount = await DiscountCode.findOne({
        code: discountCode.toUpperCase(),
        eventId,
        isActive: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });
      if (!discount) {
        // ✅ FIX: release the reserved supply atomically instead of a
        // non-atomic read-modify-write on the in-memory document.
        if (!isVirtual && ticketType) {
          await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
        }
        return NextResponse.json({ error: 'Invalid or expired discount code' }, { status: 400 });
      }

      const remainingUses = discount.maxUses - discount.usedCount;
      if (remainingUses < quantity) {
        if (!isVirtual && ticketType) {
          await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
        }
        return NextResponse.json({ error: `Discount code can only be used for ${remainingUses} more ticket(s)` }, { status: 400 });
      }

      // ✅ SECURITY FIX: never trust a client-supplied discountPercent.
      // Previously this was `discountPercent || discount.discountPercent`,
      // which let anyone calling this endpoint directly (bypassing the UI)
      // pass an arbitrary discountPercent (e.g. 99) alongside any real,
      // currently-valid discount code and have it accepted, because the
      // mismatch check below only verified internal consistency of the
      // attacker's own numbers — not the truth. The percent must always
      // come from the validated DB record.
      const discountPercentValue = discount.discountPercent;
      const discountAmountValue = (originalAmount * discountPercentValue) / 100;
      finalAmount = originalAmount - discountAmountValue;

      discountInfo = {
        codeId: discount._id,
        code: discount.code,
        percent: discountPercentValue,
        amount: discountAmountValue,
      };
      console.log(`💰 Discount applied: ${discount.code} (${discountPercentValue}%) – new amount: ${finalAmount}`);

      if (Math.abs(finalAmount - amount) > 0.01) {
        if (!isVirtual && ticketType) {
          await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
        }
        return NextResponse.json({ error: `Discount amount mismatch. Expected: ${finalAmount.toFixed(2)}` }, { status: 400 });
      }
    } else {
      if (Math.abs(originalAmount - amount) > 0.01) {
        if (!isVirtual && ticketType) {
          await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
        }
        return NextResponse.json({ error: `Amount mismatch. Expected: ${originalAmount.toFixed(2)}` }, { status: 400 });
      }
    }

    // 5. Create transaction reference
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    const tx_ref = `CACK-${timestamp}-${random}`.toUpperCase();

    // 6. Initialize Flutterwave payment
    const redirect_url = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/payment/success?reference=${tx_ref}&provider=flutterwave`;

    const flutterwaveSecretKey = process.env.FLW_SECRET_KEY;
    if (!flutterwaveSecretKey) {
      console.error('❌ FLW_SECRET_KEY is not set in environment');
      return NextResponse.json({ error: 'Payment service misconfigured - missing FLW_SECRET_KEY' }, { status: 500 });
    }

    console.log(`⏳ Contacting Flutterwave API...`);
    console.log(`💰 Amount: ${finalAmount}, Reference: ${tx_ref}`);
    
    // Flutterwave payment payload
    const flutterwavePayload = {
      tx_ref: tx_ref,
      amount: finalAmount,
      currency: 'NGN',
      redirect_url: redirect_url,
      customer: {
        email: email,
        name: userName || email.split('@')[0] || 'User',
      },
      customizations: {
        title: process.env.NEXT_PUBLIC_APP_NAME || 'CACK-pass',
        description: `Ticket for ${event.title}`,
        logo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/logoosm.png`,
      },
      meta: {
        eventId: eventId.toString(),
        ticketTypeId: realTicketTypeId?.toString(),
        quantity: quantity,
        userId: user._id.toString(),
        isVirtual,
        originalAmount,
        discountCode: discountInfo?.code || null,
        discountPercent: discountInfo?.percent || null,
        discountAmount: discountInfo?.amount || null,
        userEmail: email,
        userName: userName || email.split('@')[0] || 'User',
        isGuest: isGuest || false,
      },
      payment_options: 'card,ussd,banktransfer,account',
    };

    console.log('📤 Sending to Flutterwave:', JSON.stringify(flutterwavePayload, null, 2));

    let flutterwaveResponse;
    try {
      flutterwaveResponse = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${flutterwaveSecretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flutterwavePayload),
      });
    } catch (fetchError: any) {
      console.error('❌ Flutterwave network error:', fetchError.message);
      if (!isVirtual && ticketType) {
        await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
      }
      return NextResponse.json(
        { error: 'Payment service is currently unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    const flutterwaveData = await flutterwaveResponse.json();
    console.log('📥 Flutterwave Response:', JSON.stringify(flutterwaveData, null, 2));

    if (!flutterwaveData.status) {
      if (!isVirtual && ticketType) {
        await TicketType.updateOne({ _id: ticketType._id }, { $inc: { currentSupply: -quantity } });
      }
      console.error('❌ Flutterwave API error:', flutterwaveData);
      return NextResponse.json(
        { error: flutterwaveData.message || 'Payment initialization failed' },
        { status: 400 }
      );
    }

    // 7. Create Order and Payment records
    try {
      const order = await Order.create({
        userId: user._id,
        eventId,
        ticketTypeId: realTicketTypeId,
        quantity,
        totalAmount: finalAmount,
        originalAmount,
        paymentMethod: 'flutterwave',
        paymentStatus: 'pending',
        paymentReference: tx_ref,
        customerEmail: email,
        customerName: userName || email.split('@')[0] || 'User',
        metadata: {
          isVirtual,
          ticketName,
          eventTitle: event.title,
          discountCode: discountInfo?.code || null,
          discountPercent: discountInfo?.percent || null,
          discountAmount: discountInfo?.amount || null,
          isGuest: isGuest || false,
          flutterwaveLink: flutterwaveData.data.link,
        },
      });
      console.log(`✅ Order created: ${order._id}`);

      await Payment.create({
        paymentMethod: 'flutterwave',
        userId: user._id,
        eventId,
        amount: finalAmount,
        originalAmount,
        quantity,
        ticketTypeId: realTicketTypeId,
        paymentStatus: 'pending',
        paymentReference: tx_ref,
        customerEmail: email,
        metadata: {
          orderId: order._id,
          userName: userName || email.split('@')[0] || 'User',
          isVirtual,
          eventTitle: event.title,
          ticketName,
          eventVenue: event.venue || 'Online Event',
          eventStartDate: event.startDate,
          eventEndDate: event.endDate,
          discountCode: discountInfo?.code || null,
          discountPercent: discountInfo?.percent || null,
          discountAmount: discountInfo?.amount || null,
          isGuest: isGuest || false,
          flutterwaveLink: flutterwaveData.data.link,
        },
      });
      console.log(`✅ Payment record created for reference: ${tx_ref}`);

    } catch (dbError: any) {
      console.error('❌ Database error creating order/payment:', dbError);
      // Don't fail the request if DB save fails, but log it
    }

    console.log(`✅ Payment initialized successfully. Reference: ${tx_ref}, Amount: ${finalAmount}`);

  return NextResponse.json({
    success: true,
    authorization_url: flutterwaveData.data.link,
    reference: tx_ref,
    // ADD THESE FOR INLINE MODAL
    transaction: {
      tx_ref: tx_ref,
      amount: finalAmount,
      currency: 'NGN',
      customer: {
        email: email,
        name: userName || email.split('@')[0] || 'User',
      },
      meta: {
        eventId: eventId.toString(),
        ticketTypeId: realTicketTypeId?.toString(),
        quantity: quantity,
        userId: user._id.toString(),
      }
    },
    message: 'Payment initialized successfully',
  });
  } catch (error: any) {
    console.error('❌ Flutterwave initialization error:', error);
    console.error('Stack:', error.stack);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      },
      { status: 500 }
    );
  }
}