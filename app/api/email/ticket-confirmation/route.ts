// app/api/email/ticket-confirmation/route.ts

import { NextRequest, NextResponse } from 'next/server';

// Lazy load heavy dependencies (only load when API is called)
let nodemailer: any = null;
let QRCode: any = null;

async function getNodemailer() {
  if (!nodemailer) {
    nodemailer = await import('nodemailer');
  }
  return nodemailer;
}

async function getQRCode() {
  if (!QRCode) {
    QRCode = await import('qrcode');
  }
  return QRCode;
}

// Create transporter outside the handler for reuse
let transporter: any = null;

async function getTransporter() {
  if (!transporter) {
    const { createTransport } = await getNodemailer();
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass) {
      throw new Error('Missing Gmail credentials');
    }

    transporter = createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

export async function POST(request: NextRequest) {
  console.log('📧 Ticket confirmation email API called');

  try {
    const body = await request.json();
    console.log('📧 Request body:', body);

    const {
      email,
      name,
      eventTitle,
      eventDate,
      venue,
      ticketCount,
      ticketType,
      amount,
      reference,
    } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Recipient email is required' },
        { status: 400 }
      );
    }

    if (!eventTitle) {
      return NextResponse.json(
        { error: 'Event title is required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailPass) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 }
      );
    }

    // Dynamic import for database (loads only when needed)
    const { connectDB } = await import('@/lib/database/connection');
    const { MyTicket, Event } = await import('@/lib/database/models');
    const { generateTicketHMAC } = await import('@/lib/qr-security');

    await connectDB();

    // Find event by title
    const event = await Event.findOne({ title: eventTitle });
    if (!event) {
      console.error(`Event not found: ${eventTitle}`);
      // Continue without event ID (QR code will still work but without HMAC)
    }

    const formattedDate = eventDate
      ? new Date(eventDate).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'Date to be announced';

    const formattedTime = eventDate
      ? new Date(eventDate).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Time to be announced';

    // Find all tickets for this order
    const tickets = await MyTicket.find({
      ticketNumber: { $regex: `^${reference}-` },
    });

    if (tickets.length === 0) {
      console.error(`No tickets found for reference: ${reference}`);
      return NextResponse.json(
        {
          error: 'No tickets found for this payment reference',
          reference,
        },
        { status: 404 }
      );
    }

    // Generate QR codes in parallel as buffers for inline attachments
    const QRCodeLib = await getQRCode();

    type QrAttachment = {
      filename: string;
      content: Buffer;
      cid: string;
      contentType: string;
    };

    const qrResults = await Promise.all(
      tickets.map(async (ticket: any) => {
        try {
          const hmac = event
            ? generateTicketHMAC(ticket.ticketNumber, event._id.toString())
            : '';

          const qrPayload = JSON.stringify({
            ticketNumber: ticket.ticketNumber,
            eventId: event ? event._id.toString() : '',
            sig: hmac,
          });

          // ✅ Generate as buffer for inline attachment (not data URL)
          const qrBuffer = await QRCodeLib.toBuffer(qrPayload, {
            width: 300,
            margin: 4,
            errorCorrectionLevel: 'H',
            color: {
              dark: '#000000', // ✅ CACK-pass orange #D95427
              light: '#ffffff',
            },
          });

          // Store as data URL in DB for other uses (unchanged behavior)
          const qrDataUrl = await QRCodeLib.toDataURL(qrPayload, {
            width: 300,
            margin: 4,
            errorCorrectionLevel: 'H',
            color: {
              dark: '#D95427',
              light: '#ffffff',
            },
          });

          // ✅ Only save the QR here. The emailSent flag is written
          //    once, AFTER the email succeeds, further down.
          await MyTicket.updateOne(
            { _id: ticket._id },
            { $set: { qrCode: qrDataUrl } }
          );

          const cid = `qr-${ticket.ticketNumber}`;

          const attachment: QrAttachment = {
            filename: `${ticket.ticketNumber}.png`,
            content: qrBuffer,
            cid,
            contentType: 'image/png',
          };

          return {
            ticketNumber: ticket.ticketNumber,
            cid,
            attachment,
          };
        } catch (qrError) {
          console.error(
            `❌ QR code generation failed for ticket ${ticket.ticketNumber}:`,
            qrError
          );
          return null;
        }
      })
    );

    const qrCodes = qrResults.filter(
      (
        result
      ): result is {
        ticketNumber: string;
        cid: string;
        attachment: QrAttachment;
      } => result !== null
    );

    console.log(
      `✅ Generated and saved ${qrCodes.length} QR codes for ${tickets.length} tickets`
    );
    console.log(`📎 Preparing ${qrCodes.length} inline QR attachment(s)`);

    // Build email HTML with CID references instead of data URLs
    const ticketsHtml = qrCodes
      .map(
        (qr, index) => `
          <div class="ticket-item" style="margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
            <h3 style="color: #D95427; margin-bottom: 10px;">Ticket #${index + 1}</h3>
            <div class="ticket-detail" style="margin-bottom: 10px;">
              <span class="label" style="font-weight: 600;">Ticket ID:</span>
              <span class="value">${qr.ticketNumber}</span>
            </div>
            <div class="qr-code" style="text-align: center; margin: 15px 0;">
              <img src="cid:${qr.cid}" alt="Ticket QR Code" style="max-width: 180px; height: auto;" />
              <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">
                Scan this QR code at the event entrance
              </p>
            </div>
          </div>
        `
      )
      .join('');

    // Full HTML email template
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Your Tickets - CACK-pass</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
              Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 16px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 30px 20px;
            background: linear-gradient(135deg, #D95427 0%, #B8431F 100%);
            border-radius: 12px 12px 0 0;
            color: white;
            margin: -20px -20px 0 -20px;
          }
          .header h1 { margin: 0; font-size: 28px; }
          .content { padding: 30px 20px; }
          .ticket-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            border-left: 4px solid #D95427;
          }
          .ticket-detail {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #dee2e6;
          }
          .ticket-detail:last-child { border-bottom: none; }
          .label { font-weight: 600; color: #495057; }
          .value { color: #212529; }
          .button {
            display: inline-block;
            background: linear-gradient(135deg, #D95427 0%, #B8431F 100%);
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 8px;
            margin-top: 20px;
            font-weight: 600;
          }
          .footer {
            text-align: center;
            padding: 20px;
            font-size: 12px;
            color: #6c757d;
            border-top: 1px solid #dee2e6;
            margin-top: 20px;
          }
          .info-box {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 8px;
          }
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
            <h2>Hello ${name || 'there'}! 👋</h2>
            <p>
              Your ticket${ticketCount > 1 ? 's have' : ' has'}
              been successfully booked. Here are your event details:
            </p>

            <div class="ticket-card">
              <div class="ticket-detail">
                <span class="label">🎪 Event:</span>
                <span class="value"><strong>${eventTitle}</strong></span>
              </div>
              <div class="ticket-detail">
                <span class="label">📅 Date:</span>
                <span class="value">${formattedDate}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">⏰ Time:</span>
                <span class="value">${formattedTime}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">📍 Venue:</span>
                <span class="value">${venue || 'Online Event'}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">🎟️ Ticket Type:</span>
                <span class="value">${ticketType || 'General Admission'}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">🔢 Quantity:</span>
                <span class="value">${ticketCount} ticket${ticketCount > 1 ? 's' : ''}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">💰 Amount Paid:</span>
                <span class="value">₦${(amount || 0).toLocaleString()}</span>
              </div>
              <div class="ticket-detail">
                <span class="label">🆔 Reference:</span>
                <span class="value">${reference}</span>
              </div>
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
                <li>Tickets are non-transferable without prior authorization</li>
              </ul>
            </div>
          </div>

          <div class="footer">
            <p>© ${new Date().getFullYear()} CACK-pass. All rights reserved.</p>
            <p>
              Need help? Contact us at
              <a href="mailto:support@cackpass.com">support@cackpass.com</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = await getTransporter();
    const mailOptions = {
      from: `"CACK-pass" <${gmailUser}>`,
      to: email,
      subject: `🎫 Your Tickets for ${eventTitle} - CACK-pass`,
      html: emailHtml,
      // ✅ Inline QR attachments — Gmail renders these reliably
      attachments: qrCodes.map((qr) => qr.attachment),
    };

    const info = await transporter.sendMail(mailOptions);

    // ========================================================
    // ✅ FIX: Mark tickets as emailed — THE MISSING WRITE
    //
    // This was completely absent from the original Version B.
    // It now runs exactly once, after sendMail succeeds, so
    // every fresh purchase flips the flag.
    // ========================================================

    try {
      const updateResult = await MyTicket.updateMany(
        { ticketNumber: { $regex: `^${reference}-` } },
        {
          $set: {
            'metadata.emailSent': true,
            'metadata.sentAt': new Date(),
            'metadata.emailMessageId': info.messageId,
          },
        }
      );

      console.log(
        `📝 Marked as sent: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount} (reference=${reference})`
      );

      if (updateResult.matchedCount === 0) {
        console.warn(
          `⚠️ emailSent flag was NOT written: no tickets matched reference "${reference}-*". Verify the reference matches the ticket-number prefix.`
        );
      }
    } catch (updateError: any) {
      // Do not fail the request — the email was already delivered.
      console.error(
        '⚠️ Email delivered but failed to mark tickets as emailSent:',
        updateError?.message || updateError
      );
    }

    console.log('✅ Ticket confirmation email sent successfully:', {
      messageId: info.messageId,
      to: email,
      attachments: qrCodes.length,
    });

    return NextResponse.json({
      success: true,
      message: 'Ticket confirmation email sent successfully',
      messageId: info.messageId,
      to: email,
      attachmentsCount: qrCodes.length,
    });
  } catch (error: any) {
    console.error('❌ Ticket confirmation email error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Test endpoint
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const testEmail = searchParams.get('test');

  if (testEmail) {
    try {
      const gmailUser = process.env.GMAIL_USER;
      const gmailPass = process.env.GMAIL_APP_PASSWORD;

      if (!gmailUser || !gmailPass) {
        return NextResponse.json(
          { error: 'Missing Gmail credentials' },
          { status: 500 }
        );
      }

      const { createTransport } = await import('nodemailer');
      const transporter = createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });

      const info = await transporter.sendMail({
        from: `"CACK-pass Tickets" <${gmailUser}>`,
        to: testEmail,
        subject: 'Test Email from CACK-pass - Ticket Confirmation',
        html: '<h1>Test Successful!</h1><p>Your ticket confirmation email configuration is working.</p>',
      });

      return NextResponse.json({
        success: true,
        message: 'Test email sent',
        messageId: info.messageId,
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    message: 'CACK-pass Ticket Purchase Confirmation Email',
    endpoints: {
      'POST /': 'Send ticket confirmation email to customer',
      'GET /?test=email@example.com': 'Send test email to verify configuration',
    },
  });
}