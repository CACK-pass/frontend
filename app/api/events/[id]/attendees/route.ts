// /app/api/events/[id]/attendees/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/database/connection'
import { MyTicket, User, Order, TicketType } from '@/lib/database/models'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB()
    const { id: eventId } = await params

    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid event ID' },
        { status: 400 }
      )
    }

    // Fetch all tickets for this event
    const tickets = await MyTicket.find({ eventId })
      .populate({
        path: 'userId',
        model: User,
        select: 'firstName lastName email walletAddress username phoneNumber',
      })
      .populate({
        path: 'ticketTypeId',
        model: TicketType,
        select: 'name category price',
      })
      .populate({
        path: 'orderId',
        model: Order,
        select: 'paymentMethod paymentStatus totalAmount currency createdAt paymentReference',
      })
      .sort({ createdAt: -1 })
      .lean()

    // Aggregate by buyer so multiple tickets for the same buyer appear once
    // with a ticket count. Also include the ticket numbers (useful for
    // exporting individual tickets).
    type AttendeeRow = {
      buyerId: string
      name: string
      email: string
      walletAddress: string
      phoneNumber: string
      ticketCount: number
      ticketNumbers: string[]
      ticketType: string
      paymentMethod: string
      paymentStatus: string
      totalPaid: number
      currency: string
      purchaseDate: string
      reference: string
      status: string
    }

    const rows: Record<string, AttendeeRow> = {}

    for (const t of tickets as any[]) {
      const buyer = t.userId || {}
      const type = t.ticketTypeId || {}
      const order = t.orderId || {}

      const key =
        buyer._id?.toString() ||
        t.customerEmail ||
        t.ticketNumber

      if (!rows[key]) {
        rows[key] = {
          buyerId: buyer._id?.toString() || '',
          name:
            `${buyer.firstName || ''} ${buyer.lastName || ''}`.trim() ||
            t.customerName ||
            buyer.username ||
            'Guest',
          email: buyer.email || t.customerEmail || '',
          walletAddress: buyer.walletAddress || '',
          phoneNumber: buyer.phoneNumber || '',
          ticketCount: 0,
          ticketNumbers: [],
          ticketType: type.name || '',
          paymentMethod: order.paymentMethod || '',
          paymentStatus: order.paymentStatus || '',
          totalPaid: 0,
          currency: order.currency || 'NGN',
          purchaseDate: order.createdAt
            ? new Date(order.createdAt).toISOString()
            : new Date(t.createdAt).toISOString(),
          reference: order.paymentReference || '',
          status: t.status || 'active',
        }
      }

      rows[key].ticketCount += 1
      rows[key].ticketNumbers.push(t.ticketNumber)
      // Accumulate order total only once per order (safest: sum on the first ticket)
      if (rows[key].ticketCount === 1) {
        rows[key].totalPaid = (order.totalAmount as number) || 0
      }
    }

    const attendees = Object.values(rows)

    return NextResponse.json({
      success: true,
      attendees,
      total: attendees.length,
      totalTickets: tickets.length,
    })
  } catch (error: any) {
    console.error('Error fetching attendees:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch attendees' },
      { status: 500 }
    )
  }
}