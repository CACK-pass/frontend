// /app/api/payments/flutterwave/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/database/connection';
import { Payment, Order, MyTicket, TicketType, Event, User, DiscountCode } from '@/lib/database/models';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reference = searchParams.get('reference');
    const transactionId = searchParams.get('transaction_id');

    console.log(`\n🔍 ========== VERIFYING PAYMENT: ${reference} ==========`);

    if (!reference) {
      return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
    }

    // 1. Find payment record
    await connectDB();

    let payment = await Payment.findOne({ paymentReference: reference });
    if (!payment) {
      console.error(`❌ Payment record not found for reference: ${reference}`);
      return NextResponse.json(
        { success: false, error: 'Payment not found' },
        { status: 404 }
      );
    }

    // If already completed, return success immediately
    if (payment.paymentStatus === 'completed') {
      console.log(`⚠️ Payment already processed - returning existing data`);

      const tickets = await MyTicket.find({ orderId: payment.metadata?.orderId });

      // Read email-sent status directly from the tickets
      const wasEmailSent = tickets.some((t: any) => t.metadata?.emailSent === true);

      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        tickets: tickets.map((t: any) => ({
          ticketId: t.ticketNumber,
          ticketNumber: t.ticketNumber,
        })),
        emailSent: wasEmailSent,
        amount: payment.amount,
        userEmail: payment.customerEmail,
        event: {
          ticketsSold: 0,
          capacity: 0,
        },
      });
    }

    // 2. Verify with Flutterwave
    let verifyResult;

    if (transactionId) {
      console.log(`✅ Using transaction_id from callback: ${transactionId}`);

      const flutterwaveSecretKey = process.env.FLW_SECRET_KEY;
      if (!flutterwaveSecretKey) {
        throw new Error('FLW_SECRET_KEY not configured');
      }

      const txResponse = await fetch(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: {
            'Authorization': `Bearer ${flutterwaveSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const txData = await txResponse.json();
      console.log('📥 Flutterwave verify response:', JSON.stringify(txData, null, 2));

      if (txData.status === 'success' && txData.data) {
        verifyResult = {
          success: true,
          status: txData.data.status,
          data: {
            id: txData.data.id,
            tx_ref: txData.data.tx_ref,
            flw_ref: txData.data.flw_ref,
            amount: txData.data.amount,
            currency: txData.data.currency,
            status: txData.data.status,
            customer: {
              email: txData.data.customer?.email || '',
              name: txData.data.customer?.name || '',
              phone_number: txData.data.customer?.phone_number || '',
            },
          },
        };
      } else {
        verifyResult = {
          success: false,
          status: 'error',
          data: {
            id: 0,
            tx_ref: '',
            flw_ref: '',
            amount: 0,
            currency: 'NGN',
            status: 'error',
            customer: { email: '', name: '', phone_number: '' },
          },
          error: txData.message || 'Verification failed',
        };
      }
    } else {
      console.log(`⚠️ No transaction_id provided, trying to verify with reference`);

      try {
        const flutterwaveSecretKey = process.env.FLW_SECRET_KEY;
        if (!flutterwaveSecretKey) {
          throw new Error('FLW_SECRET_KEY not configured');
        }

        const txResponse = await fetch(
          `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`,
          {
            headers: {
              'Authorization': `Bearer ${flutterwaveSecretKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const txData = await txResponse.json();
        console.log('📥 Transaction lookup response:', JSON.stringify(txData, null, 2));

        if (txData.status === 'success' && txData.data) {
          verifyResult = {
            success: true,
            status: txData.data.status,
            data: {
              id: txData.data.id,
              tx_ref: txData.data.tx_ref,
              flw_ref: txData.data.flw_ref,
              amount: txData.data.amount,
              currency: txData.data.currency,
              status: txData.data.status,
              customer: {
                email: txData.data.customer?.email || '',
                name: txData.data.customer?.name || '',
                phone_number: txData.data.customer?.phone_number || '',
              },
            },
          };
        } else {
          throw new Error('Could not find transaction by reference');
        }
      } catch (error) {
        console.error('❌ Failed to lookup transaction by reference:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to verify transaction. Please contact support.',
          },
          { status: 400 }
        );
      }
    }

    if (!verifyResult.success || verifyResult.data.status !== 'successful') {
      console.error(`❌ Payment not successful:`, verifyResult);
      return NextResponse.json(
        {
          success: false,
          error: 'Payment not successful',
          status: verifyResult.data.status,
        },
        { status: 400 }
      );
    }

    console.log(`✅ Flutterwave verification successful`);

    // 3. Get user and email
    let userEmail = payment.customerEmail || '';
    let userName = payment.metadata?.userName || userEmail.split('@')[0] || 'User';

    let user = null;
    if (payment.userId) {
      user = await User.findById(payment.userId);
      if (user && user.email) {
        userEmail = user.email;
        userName = user.firstName || user.email.split('@')[0] || 'User';
      }
    }

    // 4. Get event
    const event = await Event.findById(payment.eventId);
    if (!event) {
      console.error(`❌ Event not found for ID: ${payment.eventId}`);
      return NextResponse.json({
        success: true,
        error: 'Event not found but payment was successful',
        tickets: [],
        emailSent: false,
        amount: payment.amount,
        userEmail: userEmail,
      });
    }

    // 5. Get ticket type
    let ticketType = null;
    if (payment.ticketTypeId && !payment.metadata?.isVirtual) {
      ticketType = await TicketType.findById(payment.ticketTypeId);
    }

    // 6. Update payment status
    payment.paymentStatus = 'completed';
    payment.transactionHash = verifyResult.data.flw_ref || reference;
    await payment.save();
    console.log(`✅ Payment marked as completed`);

    // 7. Update order
    const order = await Order.findById(payment.metadata?.orderId);
    if (order) {
      order.paymentStatus = 'paid';
      await order.save();
      console.log(`✅ Order marked as paid`);
    }

    // 8. Increment discount code usage
    if (payment.metadata?.discountCode) {
      const discount = await DiscountCode.findOne({
        code: payment.metadata.discountCode.toUpperCase(),
        eventId: payment.eventId,
      });
      if (discount) {
        discount.usedCount += payment.quantity;
        await discount.save();
        console.log(
          `✅ Discount code ${discount.code} used count increased to ${discount.usedCount}/${discount.maxUses}`
        );
      }
    }

    // 9. Update ticketsSold
    console.log(`\n📊 Updating ticketsSold...`);
    await Event.updateOne(
      { _id: payment.eventId },
      { $inc: { ticketsSold: payment.quantity } }
    );

    const updatedEvent = await Event.findById(payment.eventId);
    console.log(`✅ ticketsSold updated to: ${updatedEvent?.ticketsSold}`);

    // 10. Create tickets
    let tickets = [];
    const existingTickets = await MyTicket.find({ orderId: order?._id });

    if (existingTickets.length === 0) {
      console.log(`🎫 Creating ${payment.quantity} tickets...`);
      for (let i = 0; i < payment.quantity; i++) {
        const ticket = await MyTicket.create({
          orderId: order?._id,
          userId: payment.userId,
          eventId: payment.eventId,
          ticketTypeId: payment.ticketTypeId,
          ticketNumber: `${reference}-${i + 1}`,
          status: 'active',
          customerEmail: userEmail,
          customerName: userName,
        });
        tickets.push(ticket);
      }
      console.log(`✅ Created ${tickets.length} tickets`);
    } else {
      tickets = existingTickets;
      console.log(`✅ Using ${existingTickets.length} existing tickets`);
    }

    // ========================================================
    // 11. Send email via the shared email API
    //
    // ✅ FIX: This now calls /api/email/ticket-confirmation
    //         (the same route the resend button uses).
    //
    //         That route:
    //           - generates QR codes
    //           - sends the email via Nodemailer
    //           - writes metadata.emailSent=true on the tickets
    //
    //         This means the flag is set exactly once, by the
    //         single authoritative code path.
    // ========================================================
    let emailSent = false;
    let emailError: string | null = null;

    // Look up the ticket type name if we haven't already
    const ticketTypeName =
      (ticketType as any)?.name ||
      payment.metadata?.ticketName ||
      'General Admission';

    if (userEmail && !payment.metadata?.emailSent) {
      console.log(`\n📧 ========== SENDING EMAIL ==========`);
      console.log(`📧 To: ${userEmail}`);
      console.log(`📧 Event: ${event.title}`);
      console.log(`📧 Reference: ${reference}`);

      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        if (!appUrl) {
          throw new Error('NEXT_PUBLIC_APP_URL is not configured');
        }

        const emailResponse = await fetch(
          `${appUrl}/api/email/ticket-confirmation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: userEmail,
              name: userName || userEmail.split('@')[0] || 'User',
              eventTitle: event.title,
              eventDate: (event as any).startDate?.toISOString(),
              venue: (event as any).venue || 'Online Event',
              ticketCount: payment.quantity,
              ticketType: ticketTypeName,
              amount: payment.amount,
              reference: reference,
            }),
          }
        );

        // Guard against non-JSON responses (HTML error pages, etc.)
        const contentType = emailResponse.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const rawText = await emailResponse.text();
          throw new Error(
            `Email API returned non-JSON (status ${emailResponse.status}): ${rawText.slice(0, 200)}`
          );
        }

        const emailResult = await emailResponse.json();

        if (!emailResponse.ok || !emailResult.success) {
          throw new Error(
            emailResult.error || `Email API returned HTTP ${emailResponse.status}`
          );
        }

        console.log(
          `✅ Email sent successfully to ${userEmail}:`,
          emailResult.messageId || '(no messageId)'
        );
        emailSent = true;

        // Note: /api/email/ticket-confirmation already writes
        // metadata.emailSent=true on the tickets. We just mirror
        // the flag on the Payment document for the response.
        payment.metadata = {
          ...(payment.metadata || {}),
          emailSent: true,
          emailSentAt: new Date(),
        };
        await payment.save();
      } catch (err: any) {
        console.error(`❌ EMAIL FAILED:`, err.message);
        emailError = err.message;
        // Do NOT throw — the payment is verified regardless.
      }
    } else if (payment.metadata?.emailSent) {
      console.log(`📧 Email already sent previously (payment flag)`);
      emailSent = true;
    } else {
      console.log(`📧 Skipping email — no userEmail`);
    }

    const finalEvent = await Event.findById(payment.eventId);
    const finalTicketsSold = finalEvent?.ticketsSold || 0;

    console.log(`\n🎉 ========== PAYMENT COMPLETE ==========`);
    console.log(`✅ Reference: ${reference}`);
    console.log(`✅ Tickets: ${tickets.length}`);
    console.log(`✅ Email: ${emailSent ? 'SENT ✅' : 'FAILED ❌'}`);
    console.log(
      `📊 ticketsSold: ${finalTicketsSold}/${finalEvent?.capacity || 'unlimited'}`
    );
    console.log(`========================================\n`);

    // ALWAYS return success with ticket data
    return NextResponse.json({
      success: true,
      tickets: tickets.map((t: any) => ({
        ticketId: t.ticketNumber,
        ticketNumber: t.ticketNumber,
      })),
      emailSent: emailSent,
      emailError: emailError,
      amount: payment.amount,
      userEmail: userEmail,
      event: {
        ticketsSold: finalTicketsSold,
        capacity: finalEvent?.capacity,
      },
    });
  } catch (error: any) {
    console.error('❌ VERIFY ERROR:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}