// /lib/email/ticket-confirmation.ts
import QRCode from 'qrcode';
import { sendEmail } from './gmail';

export interface TicketConfirmationParams {
  email: string;
  name: string;
  eventTitle: string;
  eventDate: string;
  venue: string;
  ticketCount: number;
  ticketType: string;
  amount: number;
  reference: string;
  tickets: Array<{
    ticketNumber: string;
    qrCode?: string;
  }>;
}

export async function sendTicketConfirmationEmail(params: TicketConfirmationParams) {
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

  const qrPromises = params.tickets.map(async (ticket) => {
    try {
      const qrData = JSON.stringify({
        ticketNumber: ticket.ticketNumber,
        eventTitle: params.eventTitle,
        reference: params.reference,
        email: params.email,
        date: formattedDate,
        venue: params.venue
      });

      const qrBuffer = await QRCode.toBuffer(qrData, {
        width: 200,
        margin: 2,
        color: {
          dark: '#D95427', // ✅ CACK-pass orange
          light: '#ffffff'
        }
      });

      const cid = `qr-${ticket.ticketNumber}`;

      const attachment: QrAttachment = {
        filename: `${ticket.ticketNumber}.png`,
        content: qrBuffer,
        cid,
        contentType: 'image/png',
      };

      return { cid, attachment };
    } catch (qrError) {
      console.error('QR code generation failed:', qrError);
      return { cid: '', attachment: null };
    }
  });

  const qrResults = await Promise.all(qrPromises);

  const ticketsHtml = params.tickets.map((ticket, index) => {
    const cid = qrResults[index]?.cid || '';
    return `
      <div class="ticket-item" style="margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
        <h3 style="color: #D95427; margin-bottom: 10px;">Ticket #${index + 1}</h3>
        <div class="ticket-detail" style="margin-bottom: 10px;">
          <span class="label" style="font-weight: 600;">Ticket ID:</span>
          <span class="value">${ticket.ticketNumber}</span>
        </div>
        <div class="qr-code" style="text-align: center; margin: 15px 0;">
          ${cid ? `<img src="cid:${cid}" alt="Ticket QR Code" style="max-width: 180px; height: auto;" />` : ''}
          <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">
            Scan this QR code at the event entrance
          </p>
        </div>
      </div>
    `;
  }).join('');

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

  const qrAttachments = qrResults
    .map((r) => r.attachment)
    .filter((a): a is QrAttachment => a !== null);

  return sendEmail({
    to: params.email,
    subject: `🎫 Your Tickets for ${params.eventTitle} - CACK-pass`,
    html: emailHtml,
    attachments: qrAttachments, // ✅ pass through to Nodemailer
  });
}