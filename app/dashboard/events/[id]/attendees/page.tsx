'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import {
  ArrowLeft,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Users,
  Mail,
  Wallet,
  Phone,
  Loader2,
  AlertCircle,
  Ticket,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Attendee {
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

interface AttendeesResponse {
  success: boolean
  attendees: Attendee[]
  total: number
  totalTickets: number
  error?: string
}

export default function AttendeesPage() {
  const params = useParams()
  const router = useRouter()
  const { user, authenticated, ready } = usePrivy()

  const eventId = params.id as string

  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [eventTitle, setEventTitle] = useState<string>('')
  const [totalTickets, setTotalTickets] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch event title (nice to show on the page + filename)
  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId) return
      try {
        const res = await fetch(`/api/events/${eventId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.success && data.event?.title) setEventTitle(data.event.title)
      } catch {
        // Non-blocking
      }
    }
    fetchEvent()
  }, [eventId])

  // Fetch attendees
  const fetchAttendees = useCallback(async () => {
    if (!eventId) return
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/events/${eventId}/attendees`)
      const data: AttendeesResponse = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch attendees')
      }

      setAttendees(data.attendees || [])
      setTotalTickets(data.totalTickets || 0)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Failed to load attendees')
      toast.error(err.message || 'Failed to load attendees')
    } finally {
      setIsLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    if (ready && authenticated) {
      fetchAttendees()
    }
  }, [ready, authenticated, fetchAttendees])

  // ---------- Export helpers ----------

  const buildFilename = (ext: string) => {
    const safeTitle = (eventTitle || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const stamp = new Date().toISOString().slice(0, 10)
    return `attendees-${safeTitle}-${stamp}.${ext}`
  }

  // ✅ JSON export
  const exportJSON = () => {
    try {
      const payload = {
        eventId,
        eventTitle,
        exportedAt: new Date().toISOString(),
        total: attendees.length,
        totalTickets,
        attendees,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      triggerDownload(blob, buildFilename('json'))
      toast.success('JSON exported')
    } catch (e) {
      toast.error('Failed to export JSON')
    }
  }

  // ✅ Excel export — CSV format that Excel opens natively
  const exportExcel = () => {
    try {
      const headers = [
        'Name',
        'Email',
        'Wallet Address',
        'Phone',
        'Ticket Type',
        'Ticket Count',
        'Ticket Numbers',
        'Total Paid',
        'Currency',
        'Payment Method',
        'Payment Status',
        'Reference',
        'Purchase Date',
        'Ticket Status',
      ]

      const escape = (val: any) => {
        const s = String(val ?? '')
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`
        }
        return s
      }

      const rows = attendees.map((a) => [
        a.name,
        a.email,
        a.walletAddress,
        a.phoneNumber,
        a.ticketType,
        a.ticketCount,
        a.ticketNumbers.join(' | '),
        a.totalPaid,
        a.currency,
        a.paymentMethod,
        a.paymentStatus,
        a.reference,
        new Date(a.purchaseDate).toLocaleString(),
        a.status,
      ])

      const csv = [
        headers.map(escape).join(','),
        ...rows.map((r) => r.map(escape).join(',')),
      ].join('\n')

      // BOM so Excel opens UTF-8 correctly
      const blob = new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8;',
      })
      triggerDownload(blob, buildFilename('csv'))
      toast.success('Excel (CSV) exported')
    } catch (e) {
      toast.error('Failed to export Excel')
    }
  }

  // ✅ PDF export — renders into a hidden iframe and prints.
  // Using an iframe avoids popup blockers that kill window.open().
  const exportPDF = () => {
    try {
      const safeTitle = escapeHtml(eventTitle || 'Event')
      const generatedAt = new Date().toLocaleString()

      const rowsHtml = attendees
        .map(
          (a) => `
            <tr>
              <td>${escapeHtml(a.name)}</td>
              <td>${escapeHtml(a.email)}</td>
              <td>${escapeHtml(a.ticketType)}</td>
              <td style="text-align:center">${a.ticketCount}</td>
              <td style="text-align:right">${a.totalPaid.toLocaleString()} ${escapeHtml(a.currency)}</td>
              <td>${escapeHtml(a.paymentMethod)}</td>
              <td>${escapeHtml(a.reference)}</td>
              <td>${new Date(a.purchaseDate).toLocaleString()}</td>
            </tr>`
        )
        .join('')

            // ✅ Filename-safe event title (browser uses the <title> as PDF filename)
      const filenameTitle = (eventTitle || 'Event')
        .replace(/[\\/:*?"<>|]/g, '')  // strip characters illegal in filenames
        .trim()

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <title>${filenameTitle} - Attendees</title>
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              margin: 24px;
              color: #111;
            }
            h1 { margin: 0 0 4px 0; color: #D95427; font-size: 20px; }
            .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
            th { background: #f5f5f5; color: #333; font-weight: 700; }
            tr:nth-child(even) td { background: #fafafa; }
            @media print {
              body { margin: 8mm; }
              table { font-size: 10px; }
              tr { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>${safeTitle} — Attendees</h1>
          <div class="meta">
            Total buyers: <strong>${attendees.length}</strong> ·
            Total tickets: <strong>${totalTickets}</strong> ·
            Generated: ${generatedAt}
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Ticket Type</th><th>Qty</th>
                <th>Total Paid</th><th>Method</th><th>Reference</th><th>Purchase Date</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
        </html>
      `

      // ✅ Create a hidden iframe (no popup blocker issues)
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.visibility = 'hidden'
      document.body.appendChild(iframe)

      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) {
        document.body.removeChild(iframe)
        toast.error('Failed to prepare PDF')
        return
      }

      doc.open()
      doc.write(html)
      doc.close()

      // ✅ Ensure the iframe document title is set — the browser uses this
      // as the default filename when the user chooses "Save as PDF".
      if (doc.title !== filenameTitle + ' - Attendees') {
        doc.title = `${filenameTitle} - Attendees`
      }

      // Wait for the iframe content to render, then trigger print
      const triggerPrint = () => {
        try {
          const win = iframe.contentWindow
          if (!win) throw new Error('No iframe window')
          win.focus()
          win.print()
          toast.success('PDF ready — choose "Save as PDF" in the print dialog')
        } catch (err) {
          console.error('Print failed:', err)
          toast.error('Failed to open print dialog')
        } finally {
          // Clean up after the print dialog closes (give it a generous delay)
          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe)
            }
          }, 2000)
        }
      }

      // Use a small delay so fonts/layout settle before printing
      if (doc.readyState === 'complete') {
        setTimeout(triggerPrint, 300)
      } else {
        iframe.onload = () => setTimeout(triggerPrint, 300)
      }
    } catch (e) {
      console.error(e)
      toast.error('Failed to export PDF')
    }
  }

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const escapeHtml = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  // ---------- Render ----------

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h2 className="text-xl font-bold mb-2">Please sign in</h2>
          <p className="text-gray-500 mb-6">You need to be signed in to view attendees.</p>
          <Link href={`/events/${eventId}`} className="btn-primary px-6 py-3">
            Back to Event
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-6"
        >
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Attendees</h1>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                {eventTitle || 'Loading event...'}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="card rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Buyers</p>
              <p className="text-2xl font-bold">{attendees.length}</p>
            </div>
            <div className="card rounded-2xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Tickets</p>
              <p className="text-2xl font-bold">{totalTickets}</p>
            </div>
            <div className="card rounded-2xl p-4 sm:col-span-1 col-span-2">
              <p className="text-xs text-gray-500 mb-2">Export</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={exportExcel}
                  disabled={attendees.length === 0}
                  className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </button>
                <button
                  onClick={exportJSON}
                  disabled={attendees.length === 0}
                  className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <FileJson className="h-4 w-4" />
                  JSON
                </button>
                <button
                  onClick={exportPDF}
                  disabled={attendees.length === 0}
                  className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <FileText className="h-4 w-4" />
                  PDF
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-gray-500">Loading attendees...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={fetchAttendees} className="btn-primary px-6 py-3">
              Retry
            </button>
          </div>
        ) : attendees.length === 0 ? (
          <div className="text-center py-20 card rounded-2xl">
            <Ticket className="h-14 w-14 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No attendees yet</h3>
            <p className="text-gray-500">Ticket buyers will appear here once they complete a purchase.</p>
          </div>
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden md:block overflow-x-auto card rounded-2xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Buyer</th>
                    <th className="text-left px-4 py-3 font-semibold">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold">Ticket Type</th>
                    <th className="text-center px-4 py-3 font-semibold">Qty</th>
                    <th className="text-right px-4 py-3 font-semibold">Paid</th>
                    <th className="text-left px-4 py-3 font-semibold">Method</th>
                    <th className="text-left px-4 py-3 font-semibold">Purchased</th>
                  </tr>
                </thead>
                <tbody>
                  {attendees.map((a) => (
                    <tr
                      key={a.buyerId || a.email || a.reference}
                      className="border-b last:border-b-0 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.name}</div>
                        {a.walletAddress && (
                          <div className="text-xs text-gray-500 font-mono">
                            {a.walletAddress.slice(0, 6)}...{a.walletAddress.slice(-4)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {a.email && (
                          <div className="flex items-center gap-1 text-xs">
                            <Mail className="h-3 w-3 text-gray-400" />
                            <span className="truncate max-w-[200px]">{a.email}</span>
                          </div>
                        )}
                        {a.phoneNumber && (
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Phone className="h-3 w-3" />
                            {a.phoneNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{a.ticketType || '—'}</td>
                      <td className="px-4 py-3 text-center font-semibold">{a.ticketCount}</td>
                      <td className="px-4 py-3 text-right">
                        {a.totalPaid.toLocaleString()} {a.currency}
                      </td>
                      <td className="px-4 py-3 capitalize">{a.paymentMethod || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(a.purchaseDate).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {attendees.map((a) => (
                <div
                  key={a.buyerId || a.email || a.reference}
                  className="card rounded-2xl p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-semibold">{a.name}</div>
                      {a.email && (
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {a.email}
                        </div>
                      )}
                      {a.walletAddress && (
                        <div className="text-xs text-gray-400 font-mono">
                          <Wallet className="inline h-3 w-3 mr-1" />
                          {a.walletAddress.slice(0, 6)}...{a.walletAddress.slice(-4)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{a.ticketCount}</div>
                      <div className="text-xs text-gray-500">ticket{a.ticketCount > 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Paid:</span>
                      <span className="font-medium">
                        {a.totalPaid.toLocaleString()} {a.currency}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Method:</span>
                      <span className="capitalize">{a.paymentMethod || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Date:</span>
                      <span>{new Date(a.purchaseDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}