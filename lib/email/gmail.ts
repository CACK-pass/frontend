import nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

// Global transporter instance for reuse
let transporter: Transporter | null = null;

/**
 * Get or create nodemailer transporter
 */
function getTransporter(): Transporter {
  if (!transporter) {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass) {
      throw new Error('Gmail credentials missing. Set GMAIL_USER and GMAIL_APP_PASSWORD');
    }

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass,
      },
      // Optional: Add connection pooling for better performance
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }
  return transporter;
}

// ✅ NEW: Attachment type for inline CID images (QR codes)
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  cid: string;
  contentType?: string;
  encoding?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  bcc?: string[];
  // ✅ NEW: optional array of inline/regular attachments
  attachments?: EmailAttachment[];
}

/**
 * Send email using Gmail SMTP
 */
export async function sendEmail({
  to,
  subject,
  html,
  from,
  replyTo,
  bcc,
  attachments,
}: SendEmailOptions) {
  try {
    const transporter = getTransporter();

    const mailOptions = {
      from: from || process.env.EMAIL_FROM || `"CACK-pass" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      ...(replyTo && { replyTo }),
      ...(bcc && bcc.length > 0 && { bcc: bcc.join(', ') }),
      // ✅ Forward attachments (inline QR images with cid) to Nodemailer
      ...(attachments && attachments.length > 0 && { attachments }),
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent successfully:`, {
      messageId: info.messageId,
      to,
      subject,
      attachments: attachments?.length || 0,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (error) {
    console.error('❌ Email send failed:', error);
    throw error;
  }
}

/**
 * Format HTML email template for event creation
 */
export function formatEventCreatedEmail(params: {
  organizerName: string;
  eventTitle: string;
  eventId: string;
  eventUrl: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  isFree: boolean;
  price: string;
  ticketType: string;
  capacity: string;
}) {
  const {
    organizerName,
    eventTitle,
    eventUrl,
    eventDate,
    eventTime,
    venue,
    isFree,
    price,
    ticketType,
    capacity,
  } = params;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Event Created - CACK-pass</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background-color: #f6f9fc;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #ffffff;
        }
        .header {
          background: linear-gradient(135deg, #D95427 0%, #c4451a 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 12px 12px 0 0;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
        }
        .header p {
          margin: 10px 0 0;
          opacity: 0.9;
        }
        .content {
          padding: 30px;
        }
        .event-details {
          background-color: #f8f9fa;
          border-radius: 12px;
          padding: 20px;
          margin: 20px 0;
        }
        .event-details h2 {
          color: #D95427;
          font-size: 18px;
          margin: 0 0 15px 0;
          padding-bottom: 10px;
          border-bottom: 2px solid #e0e0e0;
        }
        .detail-row {
          margin: 12px 0;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .detail-icon {
          font-size: 20px;
          min-width: 24px;
        }
        .detail-text {
          flex: 1;
          color: #333;
        }
        .detail-label {
          font-weight: 600;
          color: #555;
        }
        .button {
          display: inline-block;
          background-color: #D95427;
          color: white;
          text-decoration: none;
          padding: 12px 30px;
          border-radius: 8px;
          font-weight: 600;
          margin: 20px 0;
          text-align: center;
        }
        .button:hover {
          background-color: #c4451a;
        }
        .share-box {
          background-color: #f0f7ff;
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          word-break: break-all;
        }
        .share-box a {
          color: #D95427;
          text-decoration: none;
        }
        .footer {
          text-align: center;
          padding: 20px;
          border-top: 1px solid #e0e0e0;
          color: #8898aa;
          font-size: 12px;
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }
        .badge-free {
          background-color: #10b981;
          color: white;
        }
        .badge-paid {
          background-color: #D95427;
          color: white;
        }
        @media (max-width: 600px) {
          .container {
            width: 100%;
          }
          .content {
            padding: 20px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Event Created!</h1>
          <p>Your event is now live on CACK-pass</p>
        </div>
        
        <div class="content">
          <p style="font-size: 16px; line-height: 1.5; color: #333;">
            Hi <strong>${organizerName}</strong>,
          </p>
          
          <p style="font-size: 16px; line-height: 1.5; color: #333;">
            Your event <strong>"${eventTitle}"</strong> has been successfully created and is now ready to share with attendees!
          </p>
          
          <div class="event-details">
            <h2>📋 Event Details</h2>
            
            <div class="detail-row">
              <div class="detail-icon">📅</div>
              <div class="detail-text">
                <span class="detail-label">Date:</span> ${eventDate}
              </div>
            </div>
            
            <div class="detail-row">
              <div class="detail-icon">⏰</div>
              <div class="detail-text">
                <span class="detail-label">Time:</span> ${eventTime}
              </div>
            </div>
            
            <div class="detail-row">
              <div class="detail-icon">📍</div>
              <div class="detail-text">
                <span class="detail-label">Venue:</span> ${venue}
              </div>
            </div>
            
            <div class="detail-row">
              <div class="detail-icon">🎟️</div>
              <div class="detail-text">
                <span class="detail-label">Ticket Type:</span> ${ticketType}
              </div>
            </div>
            
            <div class="detail-row">
              <div class="detail-icon">💰</div>
              <div class="detail-text">
                <span class="detail-label">Price:</span> 
                ${isFree 
                  ? '<span class="badge badge-free" style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background-color: #10b981; color: white;">FREE</span>' 
                  : `<span class="badge badge-paid" style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background-color: #D95427; color: white;">${price}</span>`
                }
              </div>
            </div>
            
            <div class="detail-row">
              <div class="detail-icon">👥</div>
              <div class="detail-text">
                <span class="detail-label">Capacity:</span> ${capacity}
              </div>
            </div>
          </div>
          
          <div style="text-align: center;">
            <a href="${eventUrl}" class="button" style="display: inline-block; background-color: #D95427; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
              View Your Event
            </a>
          </div>
          
          <div class="share-box">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #333;">
              📢 Share this link with attendees:
            </p>
            <a href="${eventUrl}" style="color: #D95427; text-decoration: none; word-break: break-all;">
              ${eventUrl}
            </a>
            <button onclick="navigator.clipboard.writeText('${eventUrl}')" style="margin-top: 10px; padding: 6px 12px; background-color: #e0e0e0; border: none; border-radius: 6px; cursor: pointer;">
              Copy Link
            </button>
          </div>
          
          <div style="background-color: #fff3e0; border-left: 4px solid #D95427; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #333;">
              <strong>💡 Pro Tip:</strong> You can edit your event details anytime from your dashboard.
              Need to make changes? Visit your dashboard to update date, time, location, or ticket info.
            </p>
          </div>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} CACK-pass. All rights reserved.</p>
          <p>Questions? Contact us at <a href="mailto:support@cackpass.com" style="color: #D95427;">support@cackpass.com</a></p>
          <p style="font-size: 11px;">This email was sent to the event organizer. You received this because you created an event on CACK-pass.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}