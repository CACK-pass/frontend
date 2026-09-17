// /app/api/payments/flutterwave/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/database/connection';
import { Payment, Order, MyTicket, TicketType, Event, User, DiscountCode } from '@/lib/database/models';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';

// Create transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass) {
      throw new Error('Missing Gmail credentials');
    }

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

// Email sending function
async function sendTicketConfirmationEmail(params: {
  email: string;
  name: string;
  eventTitle: string;
  eventDate: string;
  venue: string;
  ticketCount: number;
  ticketType: string;
  amount: number;
  reference: string;
  tickets: Array<{ ticketNumber: string; qrCode?: string }>;
}) {
  const gmailUser = process.env.GMAIL_USER;

  if (!gmailUser) {
    throw new Error('Missing Gmail credentials');
  }

  const formattedDate = params.eventDate ? new Date(params.eventDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Date to be announced';

  const formattedTime = params.eventDate ? new Date(params.eventDate).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }) : 'Time to be announced';

  // ✅ Generate QR codes as buffers for inline attachments
  type QrAttachment = {
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
  };

  const qrAttachments: QrAttachment[] = [];
  const qrCids: string[] = [];

  for (const ticket of params.tickets) {
    try {
      const qrData = JSON.stringify({
        ticketNumber: ticket.ticketNumber,
        eventTitle: params.eventTitle,
        ticketCount: params.ticketCount,
        email: params.email,
        date: formattedDate,
        venue: params.venue,
        reference: params.reference
      });

      // ✅ Generate as buffer with orange color for inline attachment
      const qrBuffer = await QRCode.toBuffer(qrData, {
        width: 200,
        margin: 2,
        color: {
          dark: '#D95427', // ✅ CACK-pass orange
          light: '#ffffff'
        }
      });

      const cid = `qr-${ticket.ticketNumber}`;

      qrAttachments.push({
        filename: `${ticket.ticketNumber}.png`,
        content: qrBuffer,
        cid,
        contentType: 'image/png',
      });

      qrCids.push(cid);
    } catch (qrError) {
      console.error('QR code generation failed:', qrError);
      qrCids.push('');
    }
  }

  const ticketsHtml = params.tickets.map((ticket, index) => `
    <div class="ticket-item" style="margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
      <h3 style="color: #D95427; margin-bottom: 10px;">Ticket #${index + 1}</h3>
      <div class="ticket-detail" style="margin-bottom: 10px;">
        <span class="label" style="font-weight: 600;">Ticket ID:</span>
        <span class="value">${ticket.ticketNumber}</span>
      </div>
      <div class="qr-code" style="text-align: center; margin: 15px 0;">
        ${qrCids[index] ? `<img src="cid:${qrCids[index]}" alt="Ticket QR Code" style="max-width: 180px; height: auto;" />` : ''}
        <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">
          Scan this QR code at the event entrance
        </p>
      </div>
    </div>
  `).join('');

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Your Tickets - CACK-pass</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; padding: 30px 20px; background: linear-gradient(135deg, #D95427 0%, #B8431F 100%); border-radius: 12px 12px 0 0; color: white; margin: -20px -20px 0 -20px; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { padding: 30px 20px; }
        .ticket-card { background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #D95427; }
        .ticket-detail { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #dee2e6; }
        .ticket-detail:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #495057; }
        .value { color: #212529; }
        .button { display: inline-block; background: linear-gradient(135deg, #D95427 0%, #B8431F 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; font-weight: 600; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #6c757d; border-top: 1px solid #dee2e6; margin-top: 20px; }
        .info-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 8px; }
        .info-box h4 { margin: 0 0 10px 0; color: #856404; }
        .info-box ul { margin: 0; padding-left: 20px; color: #856404; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎫 Your Tickets are Ready!</h1>
          <p>Thank you for your purchase</p>
        </div>
        <div class="content">
          <h2>Hello ${params.name}! 👋</h2>
          <p>Your ticket${params.ticketCount > 1 ? 's have' : ' has'} been successfully booked. Here are your event details:</p>
          <div class="ticket-card">
            <div class="ticket-detail"><span class="label">🎪 Event:</span><span class="value"><strong>${params.eventTitle}</strong></span></div>
            <div class="ticket-detail"><span class="label">📅 Date:</span><span class="value">${formattedDate}</span></div>
            <div class="ticket-detail"><span class="label">⏰ Time:</span><span class="value">${formattedTime}</span></div>
            <div class="ticket-detail"><span class="label">📍 Venue:</span><span class="value">${params.venue || 'Online Event'}</span></div>
            <div class="ticket-detail"><span class="label">🎟️ Ticket Type:</span><span class="value">${params.ticketType}</span></div>
            <div class="ticket-detail"><span class="label">🔢 Quantity:</span><span class="value">${params.ticketCount} ticket${params.ticketCount > 1 ? 's' : ''}</span></div>
            <div class="ticket-detail"><span class="label">💰 Amount Paid:</span><span class="value">₦${params.amount.toLocaleString()}</span></div>
            <div class="ticket-detail"><span class="label">🆔 Reference:</span><span class="value">${params.reference}</span></div>
          </div>
          <h3 style="margin-top: 30px;">Your Digital Tickets</h3>
          <p>Each ticket has its own QR code. Please keep them safe.</p>
          ${ticketsHtml}
          <div style="text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/tickets" class="button">
              View My Tickets
            </a>
          </div>
          <div class="info-box">
            <h4>⚠️ Important Information</h4>
            <ul>
              <li>Please arrive at least 30 minutes before the event starts</li>
              <li>Show your QR code at the entrance (digital or printed)</li>
              <li>Each ticket must be scanned separately for entry</li>
            </ul>
          </div>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} CACK-pass. All rights reserved.</p>
          <p>Need help? Contact us at <a href="mailto:support@cackpass.com">support@cackpass.com</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const transporter = getTransporter();
  const mailOptions = {
    from: `"CACK-pass" <${gmailUser}>`,
    to: params.email,
    subject: `🎫 Your Tickets for ${params.eventTitle} - CACK-pass`,
    html: emailHtml,
    // ✅ Attach QR buffers so Gmail renders them inline via cid
    attachments: qrAttachments,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

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
      return NextResponse.json({ 
        success: false,
        error: 'Payment not found' 
      }, { status: 404 });
    }

    // If already completed, return success immediately
    if (payment.paymentStatus === 'completed') {
      console.log(`⚠️ Payment already processed - returning existing data`);
      const tickets = await MyTicket.find({ orderId: payment.metadata?.orderId });
      const wasEmailSent = payment.metadata?.emailSent === true;
      
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        tickets: tickets.map((t: any) => ({ 
          ticketId: t.ticketNumber,
          ticketNumber: t.ticketNumber 
        })),
        emailSent: wasEmailSent,
        amount: payment.amount,
        userEmail: payment.customerEmail,
        event: {
          ticketsSold: 0,
          capacity: 0
        }
      });
    }

    // 2. Verify with Flutterwave
    let verifyResult;
    
    if (transactionId) {
      console.log(`✅ Using transaction_id from callback: ${transactionId}`);
      
      // Call Flutterwave API directly with the transaction ID
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
          }
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
      // Try to verify using reference
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
            }
          };
        } else {
          throw new Error('Could not find transaction by reference');
        }
      } catch (error) {
        console.error('❌ Failed to lookup transaction by reference:', error);
        return NextResponse.json({
          success: false,
          error: 'Failed to verify transaction. Please contact support.'
        }, { status: 400 });
      }
    }

    if (!verifyResult.success || verifyResult.data.status !== 'successful') {
      console.error(`❌ Payment not successful:`, verifyResult);
      return NextResponse.json({ 
        success: false,
        error: 'Payment not successful', 
        status: verifyResult.data.status 
      }, { status: 400 });
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
      // Still return success since payment is verified
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
        console.log(`✅ Discount code ${discount.code} used count increased to ${discount.usedCount}/${discount.maxUses}`);
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
          customerName: userName
        });
        tickets.push(ticket);
      }
      console.log(`✅ Created ${tickets.length} tickets`);
    } else {
      tickets = existingTickets;
      console.log(`✅ Using ${existingTickets.length} existing tickets`);
    }

    // 11. Send email (don't let it break the response)
    let emailSent = false;
    let emailError = null;

    if (userEmail && !payment.metadata?.emailSent) {
      console.log(`\n📧 ========== SENDING EMAIL ==========`);
      console.log(`📧 To: ${userEmail}`);
      console.log(`📧 Event: ${event.title}`);
      
      try {
        const emailTickets = tickets.map((t: any) => ({
          ticketNumber: t.ticketNumber,
          qrCode: t.qrCode || '',
        }));

        await sendTicketConfirmationEmail({
          email: userEmail,
          name: userName || userEmail.split('@')[0] || 'User',
          eventTitle: event.title,
          eventDate: event.startDate?.toISOString(),
          venue: event.venue || 'Online Event',
          ticketCount: payment.quantity,
          ticketType: ticketType?.name || payment.metadata?.ticketName || 'General Admission',
          amount: payment.amount,
          reference: reference,
          tickets: emailTickets,
        });
        
        console.log(`✅ Email sent successfully to ${userEmail}`);
        emailSent = true;
        payment.metadata.emailSent = true;
        await payment.save();
        
      } catch (emailError: any) {
        console.error(`❌ EMAIL FAILED:`, emailError.message);
        emailError = emailError.message;
        // DON'T THROW - just continue
      }
    } else if (payment.metadata?.emailSent) {
      console.log(`📧 Email already sent previously`);
      emailSent = true;
    }

    const finalEvent = await Event.findById(payment.eventId);
    const finalTicketsSold = finalEvent?.ticketsSold || 0;

    console.log(`\n🎉 ========== PAYMENT COMPLETE ==========`);
    console.log(`✅ Reference: ${reference}`);
    console.log(`✅ Tickets: ${tickets.length}`);
    console.log(`✅ Email: ${emailSent ? 'SENT ✅' : 'FAILED ❌'}`);
    console.log(`📊 ticketsSold: ${finalTicketsSold}/${finalEvent?.capacity || 'unlimited'}`);
    console.log(`========================================\n`);

    // ALWAYS return success with ticket data
    return NextResponse.json({
      success: true,
      tickets: tickets.map((t: any) => ({ 
        ticketId: t.ticketNumber,
        ticketNumber: t.ticketNumber 
      })),
      emailSent: emailSent,
      emailError: emailError,
      amount: payment.amount,
      userEmail: userEmail,
      event: {
        ticketsSold: finalTicketsSold,
        capacity: finalEvent?.capacity
      }
    });

  } catch (error: any) {
    console.error('❌ VERIFY ERROR:', error);
    return NextResponse.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
}