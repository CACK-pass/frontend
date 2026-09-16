// /app/api/payments/flutterwave/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/database/connection';
import { Payment, Order, MyTicket, TicketType, Event, DiscountCode } from '@/lib/database/models';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature
    const signature = request.headers.get('verif-hash');
    const secretHash = process.env.FLW_SECRET_HASH;

    if (!signature || signature !== secretHash) {
      console.error('Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = await request.json();
    console.log('📨 Flutterwave webhook received:', payload);

    // Only process successful charges
    if (payload.event !== 'charge.completed') {
      return NextResponse.json({ received: true });
    }

    const { data } = payload;
    const reference = data.tx_ref;

    // Connect to DB
    await connectDB();

    // Find payment
    const payment = await Payment.findOne({ paymentReference: reference });
    if (!payment || payment.paymentStatus === 'completed') {
      return NextResponse.json({ received: true });
    }

    // Update payment
    payment.paymentStatus = 'completed';
    payment.transactionHash = data.flw_ref || reference;
    await payment.save();

    // Update order
    const order = await Order.findById(payment.metadata?.orderId);
    if (order) {
      order.paymentStatus = 'paid';
      await order.save();
    }

    // Update ticket supply
    const ticketType = await TicketType.findById(payment.ticketTypeId);
    if (ticketType && !payment.metadata?.supplyUpdated) {
      ticketType.currentSupply += payment.quantity;
      await ticketType.save();
      payment.metadata.supplyUpdated = true;
      await payment.save();
    }

    // Get event details
    const eventDoc = await Event.findById(payment.eventId);

    // Create tickets if not already created
    const existingTickets = await MyTicket.findOne({ orderId: order?._id });
    if (!existingTickets && !payment.metadata?.ticketsCreated) {
      for (let i = 0; i < payment.quantity; i++) {
        await MyTicket.create({
          orderId: order?._id,
          userId: payment.userId,
          eventId: payment.eventId,
          ticketTypeId: payment.ticketTypeId,
          ticketNumber: `${reference}-${i + 1}`,
          status: 'active',
          customerEmail: payment.customerEmail,
          customerName: payment.metadata?.userName
        });
      }
      payment.metadata.ticketsCreated = true;
      await payment.save();
    }

    // Send email confirmation
    if (payment.customerEmail && eventDoc && !payment.metadata?.emailSent) {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/email/ticket-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: payment.customerEmail,
            name: payment.metadata?.userName || payment.customerEmail.split('@')[0],
            eventTitle: eventDoc.title,
            eventDate: eventDoc.startDate,
            venue: eventDoc.venue,
            ticketCount: payment.quantity,
            ticketType: ticketType?.name,
            amount: payment.amount,
            reference: reference
          })
        });
        payment.metadata.emailSent = true;
        await payment.save();
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
      }
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    // Always return 200 to prevent Flutterwave retries always
    return NextResponse.json({ received: true });
  }
}