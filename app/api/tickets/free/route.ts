import { NextRequest, NextResponse } from 'next/server'
import { PrivyClient } from '@privy-io/server-auth'
import { connectDB } from '@/lib/database/connection'
import mongoose from 'mongoose'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'

// Initialize Privy client
const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  process.env.PRIVY_APP_SECRET || ''
)

// Rate limiting store
const rateLimitStore = new Map<string, { count: number, resetTime: number }>()
const RATE_LIMIT_WINDOW = 3600000 // 1 hour in milliseconds
const MAX_FREE_TICKETS_PER_HOUR = 10 // ✅ Changed from 5 to 10

// Email transporter (same as paid tickets)
let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (!transporter) {
    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD

    if (!user || !pass) {
      throw new Error('Missing Gmail credentials')
    }

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    })
  }
  return transporter
}

// Email sending function using Gmail (same as paid tickets)
async function sendFreeTicketEmail(params: {
  email: string
  name: string
  eventTitle: string
  eventDate: string
  venue: string
  ticketCount: number
  ticketType: string
  ticketId: string
  qrCodeDataUrl?: string  // optional now — we regenerate as buffer
}) {
  const gmailUser = process.env.GMAIL_USER

  if (!gmailUser) {
    throw new Error('Missing Gmail credentials')
  }

  const formattedDate = params.eventDate ? new Date(params.eventDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Date to be announced'

  const formattedTime = params.eventDate ? new Date(params.eventDate).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  }) : 'Time to be announced'

  // ✅ Generate QR as buffer for inline attachment (orange)
  const qrData = JSON.stringify({
    ticketId: params.ticketId,
    eventTitle: params.eventTitle,
    quantity: params.ticketCount,
    email: params.email,
    date: formattedDate,
    venue: params.venue
  })

  const qrBuffer = await QRCode.toBuffer(qrData, {
    width: 200,
    margin: 2,
    color: {
      dark: '#D95427', // ✅ CACK-pass orange
      light: '#ffffff'
    }
  })

  const cid = `qr-${params.ticketId}`

  const qrAttachment = {
    filename: `${params.ticketId}.png`,
    content: qrBuffer,
    cid,
    contentType: 'image/png',
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Your Free Ticket - CACK-pass</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
        .header { text-align: center; padding: 30px 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px 12px 0 0; color: white; margin: -20px -20px 0 -20px; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { padding: 30px 20px; }
        .ticket-card { background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #10b981; }
        .ticket-detail { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #dee2e6; }
        .ticket-detail:last-child { border-bottom: none; }
        .label { font-weight: 600; color: #495057; }
        .value { color: #212529; }
        .qr-code { text-align: center; margin: 20px 0; padding: 20px; background: white; border-radius: 12px; }
        .qr-code img { max-width: 200px; height: auto; }
        .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin-top: 20px; font-weight: 600; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #6c757d; border-top: 1px solid #dee2e6; margin-top: 20px; }
        .info-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 8px; }
        .info-box h4 { margin: 0 0 10px 0; color: #065f46; }
        .info-box ul { margin: 0; padding-left: 20px; color: #065f46; }
        .free-badge { background: #10b981; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-block; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎫 Your Free Ticket is Ready!</h1>
          <p>Thank you for claiming your free ticket</p>
        </div>
        <div class="content">
          <div style="text-align: center;"><span class="free-badge">✨ FREE TICKET ✨</span></div>
          <h2>Hello ${params.name}! 👋</h2>
          <p>Your free ticket${params.ticketCount > 1 ? 's have' : ' has'} been successfully claimed. Here are your event details:</p>
          <div class="ticket-card">
            <div class="ticket-detail"><span class="label">🎪 Event:</span><span class="value"><strong>${params.eventTitle}</strong></span></div>
            <div class="ticket-detail"><span class="label">📅 Date:</span><span class="value">${formattedDate}</span></div>
            <div class="ticket-detail"><span class="label">⏰ Time:</span><span class="value">${formattedTime}</span></div>
            <div class="ticket-detail"><span class="label">📍 Venue:</span><span class="value">${params.venue || 'Online Event'}</span></div>
            <div class="ticket-detail"><span class="label">🎟️ Ticket Type:</span><span class="value">${params.ticketType}</span></div>
            <div class="ticket-detail"><span class="label">🔢 Quantity:</span><span class="value">${params.ticketCount} ticket${params.ticketCount > 1 ? 's' : ''}</span></div>
            <div class="ticket-detail"><span class="label">💰 Amount:</span><span class="value"><strong style="color: #10b981;">FREE</strong></span></div>
            <div class="ticket-detail"><span class="label">🆔 Ticket ID:</span><span class="value">${params.ticketId}</span></div>
          </div>
          <div class="qr-code">
            <h3>Your Digital Ticket</h3>
            <img src="cid:${cid}" alt="Ticket QR Code" />
            <p>Scan this QR code at the event entrance</p>
          </div>
          <div style="text-align: center;"><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/tickets" class="button">View My Tickets</a></div>
          <div class="info-box">
            <h4>⚠️ Important Information</h4>
            <ul>
              <li>Please arrive at least 30 minutes before the event starts</li>
              <li>Bring a valid ID matching the name on the ticket</li>
              <li>Show your QR code at the entrance</li>
              <li>This is a free ticket - no payment required</li>
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
  `

  const transporter = getTransporter()
  const mailOptions = {
    from: `"CACK-pass" <${gmailUser}>`,
    to: params.email,
    subject: `🎫 Your FREE Ticket for ${params.eventTitle} - CACK-pass`,
    html: emailHtml,
    attachments: [qrAttachment], // ✅ inline attachment
  }

  const info = await transporter.sendMail(mailOptions)
  return info
}

// Type declaration for global
declare global {
  // eslint-disable-next-line no-var
  var rateLimitCleanup: NodeJS.Timeout | undefined
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  const requestId = `FREE-${Date.now().toString(36)}`
  
  console.log(`🎫 [${requestId}] Free ticket API called`)
  
  try {
    // Get authorization header
    const authHeader = request.headers.get('Authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`❌ [${requestId}] Missing auth header`)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
          requestId
        },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the token with Privy
    let verifiedClaims
    try {
      verifiedClaims = await privy.verifyAuthToken(token)
    } catch (error) {
      console.error(`❌ [${requestId}] Token verification failed:`, error)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN',
          requestId
        },
        { status: 401 }
      )
    }

    const userId = verifiedClaims.userId
    
    if (!userId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          requestId
        },
        { status: 404 }
      )
    }

    // Rate limiting
    const now = Date.now()
    const userLimit = rateLimitStore.get(userId)
    
    if (userLimit) {
      if (now < userLimit.resetTime) {
        if (userLimit.count >= MAX_FREE_TICKETS_PER_HOUR) {
          const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000)
          console.log(`⏰ [${requestId}] Rate limit exceeded for user ${userId}`)
          
          return NextResponse.json(
            { 
              success: false, 
              error: `Too many requests. Please try again in ${retryAfter} seconds.`,
              code: 'RATE_LIMITED',
              retryAfter,
              requestId
            },
            { status: 429 }
          )
        }
        userLimit.count++
      } else {
        // Reset window
        rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
      }
    } else {
      rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    }

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch (error) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid JSON body',
          code: 'INVALID_JSON',
          requestId
        },
        { status: 400 }
      )
    }
    
    const { eventId, ticketTypeId, quantity = 1 } = body
    
    // Only require eventId for free tickets
    if (!eventId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing eventId',
          code: 'MISSING_EVENT_ID',
          requestId
        },
        { status: 400 }
      )
    }
    
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 30) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Quantity must be between 1 and 30',
          code: 'INVALID_QUANTITY',
          requestId
        },
        { status: 400 }
      )
    }

    // Get user info from Privy to get wallet address
    const privyUser = await privy.getUser(userId)
    
    if (!privyUser) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'User not found in Privy',
          code: 'USER_NOT_FOUND',
          requestId
        },
        { status: 404 }
      )
    }

    // Extract wallet address from Privy user
    function getWalletAddressFromPrivyUser(user: any): string | null {
      if (!user) return null
      
      if (user.wallet?.address && typeof user.wallet.address === 'string') {
        return user.wallet.address.toLowerCase()
      }
      
      const linkedAccounts = user.linkedAccounts || []
      
      const embeddedWallet = linkedAccounts.find(
        (acc: any) => acc.type === 'wallet' && acc.walletClientType === 'privy'
      )
      
      if (embeddedWallet?.address) {
        return embeddedWallet.address.toLowerCase()
      }
      
      for (const account of linkedAccounts) {
        if (account.type === 'wallet' && account.address) {
          return account.address.toLowerCase()
        }
      }
      
      return null
    }

    const walletAddress = getWalletAddressFromPrivyUser(privyUser)
    
    if (!walletAddress) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No wallet address found. Please connect a wallet to receive tickets.',
          code: 'NO_WALLET',
          requestId
        },
        { status: 400 }
      )
    }

    console.log(`👤 [${requestId}] User ${userId}, Wallet: ${walletAddress}`)

    // Connect to database
    await connectDB()
    
    // Get User model with your schema
    const UserSchema = new mongoose.Schema({
      privyId: { type: String, required: true, unique: true },
      walletAddress: { type: String, default: null },
      loginMethod: { 
        type: String, 
        enum: ['email', 'google', 'twitter'], 
        required: true 
      },
      email: { type: String },
      firstName: { type: String },
      lastName: { type: String },
      username: { type: String },
      isOrganizer: { type: Boolean, default: false },
      country: { type: String, default: '' },
      phoneNumber: { type: String, default: '' },
      isProfileComplete: { type: Boolean, default: false },
      admin: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    })

    // Get or create models
    const User = mongoose.models.User || mongoose.model('User', UserSchema)
    
    // First try to find user by wallet address (case-insensitive)
    let user = await User.findOne({ 
      walletAddress: { $regex: new RegExp(`^${walletAddress}$`, 'i') } 
    }).lean()
    
    // If not found by wallet address, try by privyId
    if (!user) {
      user = await User.findOne({ privyId: userId }).lean()
    }
    
    // If still not found, user doesn't exist in database
    if (!user) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'User account not found. Please complete your profile first.',
          code: 'USER_NOT_REGISTERED',
          requestId
        },
        { status: 404 }
      )
    }

    // Check if user has email
    if (!user.email) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Email address not found in your profile. Please update your profile with a valid email.',
          code: 'NO_EMAIL',
          requestId
        },
        { status: 400 }
      )
    }

    // Get other models
    const Event = mongoose.models.Event || mongoose.model('Event', new mongoose.Schema({}), 'events')
    const TicketType = mongoose.models.TicketType || mongoose.model('TicketType', new mongoose.Schema({}), 'tickettypes')
    const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', new mongoose.Schema({}), 'tickets')
    
    // Validate event first
    const event = await Event.findById(eventId).lean()
    
    if (!event) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Event not found',
          code: 'EVENT_NOT_FOUND',
          requestId
        },
        { status: 404 }
      )
    }
    
    // Check if event is free
    if (!event.isFree) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'This event is not free',
          code: 'EVENT_NOT_FREE',
          requestId
        },
        { status: 400 }
      )
    }
    
    // Handle ticket type for free events
    let ticketType
    let finalTicketTypeId = ticketTypeId
    
    if (ticketTypeId) {
      // If ticketTypeId was provided, use it
      ticketType = await TicketType.findById(ticketTypeId).lean()
      
      if (!ticketType) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Ticket type not found',
            code: 'TICKET_TYPE_NOT_FOUND',
            requestId
          },
          { status: 404 }
        )
      }
      
      // Verify this is actually a free ticket if ticketTypeId was provided
      if (ticketType.price > 0) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'This is not a free ticket',
            code: 'NOT_FREE_TICKET',
            price: ticketType.price,
            requestId
          },
          { status: 400 }
        )
      }
    } else {
      // For free events without ticketTypeId, find or create a free ticket type
      console.log(`🔍 [${requestId}] No ticketTypeId provided, looking for free ticket type for event ${eventId}`)
      
      // Look for existing free ticket type for this event
      ticketType = await TicketType.findOne({
        eventId: eventId,
        price: 0
      }).lean()
      
      // If no free ticket type exists, create one
      if (!ticketType) {
        console.log(`📝 [${requestId}] Creating free ticket type for event ${eventId}`)
        
        // Create a new ticket type for free events
        const FreeTicketTypeSchema = new mongoose.Schema({
          eventId: { type: String, required: true },
          name: { type: String, default: 'Free Admission' },
          category: { type: String, default: 'General Admission' },
          price: { type: Number, default: 0 },
          maxSupply: { type: Number, default: 0 },
          currentSupply: { type: Number, default: 0 },
          isActive: { type: Boolean, default: true },
          createdAt: { type: Date, default: Date.now },
          updatedAt: { type: Date, default: Date.now }
        })
        
        const FreeTicketType = mongoose.models.TicketType || mongoose.model('TicketType', FreeTicketTypeSchema)
        
        const newTicketType = await FreeTicketType.create({
          eventId: eventId,
          name: 'Free Admission',
          category: 'General Admission', // ✅ Fixed: Space between words
          price: 0,
          maxSupply: 0,
          currentSupply: 0,
          isActive: true
        })
        
        ticketType = newTicketType.toObject()
        finalTicketTypeId = newTicketType._id.toString()
        
        console.log(`✅ [${requestId}] Created free ticket type: ${finalTicketTypeId}`)
      } else {
        finalTicketTypeId = ticketType._id.toString()
        console.log(`✅ [${requestId}] Found existing free ticket type: ${finalTicketTypeId}`)
      }
    }
    
    // Check availability (only if ticket has a max supply)
    if (ticketType.maxSupply > 0 && ticketType.currentSupply + quantity > ticketType.maxSupply) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Not enough tickets available',
          code: 'SOLD_OUT',
          available: ticketType.maxSupply - ticketType.currentSupply,
          requestId
        },
        { status: 400 }
      )
    }
    
    // Check if event is in the past
    if (new Date(event.endDate) < new Date()) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'This event has already ended',
          code: 'EVENT_ENDED',
          requestId
        },
        { status: 400 }
      )
    }
    
    // ✅ Check if user already has tickets for this event - MAX 30
    const existingTickets = await Ticket.countDocuments({
      userId: user._id,
      eventId,
      status: { $in: ['active', 'used'] }
    })
    
    if (existingTickets >= 30) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Maximum 30 tickets per event allowed. You already have ${existingTickets} tickets.`,
          code: 'MAX_TICKETS_REACHED',
          existing: existingTickets,
          requestId
        },
        { status: 400 }
      )
    }
    
    // Generate unique ticket ID
    const ticketId = `FREE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    
    // Generate QR code locally (same as paid tickets)
    let qrCodeDataUrl = ''
    try {
      const qrData = JSON.stringify({
        ticketId: ticketId,
        eventTitle: event.title,
        quantity: quantity,
        email: user.email,
        date: new Date(event.startDate).toLocaleDateString(),
        venue: event.venue || 'Online Event'
      })
      
      qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        width: 200,
        margin: 2,
        color: {
          dark: '#10b981',
          light: '#ffffff'
        }
      })
    } catch (qrError) {
      console.error('QR code generation failed:', qrError)
    }
    
    // Create ticket record
    const ticketData = {
      ticketId,
      userId: user._id,
      eventId,
      ticketTypeId: finalTicketTypeId,
      quantity,
      totalAmount: 0,
      status: 'active',
      customerEmail: user.email,
      customerName: user.firstName || user.username || 'User',
      ticketNumber: ticketId,
      metadata: {
        emailSent: false,
        emailAddress: user.email,
        walletAddress: walletAddress,
        isFree: true,
        source: 'free_ticket_api',
        userName: user.firstName || user.username || 'User',
        qrCodeDataUrl: qrCodeDataUrl
      },
      expiresAt: new Date(event.endDate),
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const ticket = await Ticket.create(ticketData)
    
    // Update ticket supply (only if ticket type has max supply)
    if (ticketType.maxSupply > 0) {
      await TicketType.findByIdAndUpdate(
        finalTicketTypeId,
        { $inc: { currentSupply: quantity } },
        { new: true }
      )
    }
    
    // ✅ Send email using Gmail (same as paid tickets)
    let emailSent = false
    
    console.log(`\n📧 ========== SENDING FREE TICKET EMAIL ==========`)
    console.log(`📧 To: ${user.email}`)
    console.log(`📧 Event: ${event.title}`)
    
    try {
      await sendFreeTicketEmail({
        email: user.email,
        name: user.firstName || user.username || user.email.split('@')[0],
        eventTitle: event.title,
        eventDate: event.startDate,
        venue: event.venue || 'Online Event',
        ticketCount: quantity,
        ticketType: ticketType.name,
        ticketId: ticket.ticketId,
        qrCodeDataUrl: qrCodeDataUrl
      })
      
      console.log(`✅ Email sent successfully to ${user.email}`)
      emailSent = true
      
      // Update ticket with email sent status
      await Ticket.findByIdAndUpdate(ticket._id, {
        'metadata.emailSent': true,
        'metadata.sentAt': new Date()
      })
      
    } catch (emailError: any) {
      console.error(`❌ EMAIL FAILED:`, emailError.message)
      emailSent = false
    }
    
    const responseTime = Date.now() - startTime
    console.log(`✅ [${requestId}] Free ticket created in ${responseTime}ms`, {
      userId: user._id,
      email: user.email,
      ticketId: ticket.ticketId,
      emailSent,
      ticketTypeId: finalTicketTypeId,
      ticketTypeSource: ticketTypeId ? 'provided' : 'auto-created'
    })
    
    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.ticketId,
        eventId,
        ticketTypeId: finalTicketTypeId,
        quantity,
        price: 0,
        currency: 'FREE',
        status: 'active',
        qrCodeDataUrl: qrCodeDataUrl
      },
      user: {
        email: user.email,
        name: user.firstName || user.username,
        emailSent: emailSent
      },
      event: {
        title: event.title,
        date: new Date(event.startDate).toLocaleDateString(),
        venue: event.venue
      },
      message: emailSent 
        ? `Free ticket with QR code sent to ${user.email}! Check your inbox.`
        : `Free ticket created! Ticket ID: ${ticket.ticketId}`,
      requestId,
      responseTime,
      timestamp: new Date().toISOString()
    })
    
  } catch (error: any) {
    const responseTime = Date.now() - startTime
    console.error(`🔥 [${requestId}] Error:`, {
      error: error.message,
      stack: error.stack,
      responseTime
    })
    
    let errorMessage = 'Failed to process free ticket request'
    let errorCode = 'PROCESSING_ERROR'
    
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      errorMessage = 'Database error occurred'
      errorCode = 'DATABASE_ERROR'
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage,
        code: errorCode,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        requestId,
        responseTime
      },
      { status: 500 }
    )
  }
}

// Initialize rate limit cleanup if not already running
if (typeof global !== 'undefined' && !global.rateLimitCleanup) {
  global.rateLimitCleanup = setInterval(() => {
    const now = Date.now()
    for (const [userId, limit] of rateLimitStore.entries()) {
      if (now > limit.resetTime + 86400000) { // 24 hours after reset
        rateLimitStore.delete(userId)
      }
    }
  }, 300000) // Run every 5 minutes
}