'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Filter, Calendar, MapPin, Ticket, Globe, Users, Clock, ChevronRight, Loader2, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'

// ==================== TYPE DEFINITIONS ====================
interface Event {
  _id: string
  id?: string
  title: string
  description: string
  venue: string
  location?: {
    address?: string
  }
  startDate: string | Date
  endDate: string | Date
  startDateTime?: string | Date
  endDateTime?: string | Date
  bannerImage?: string
  imageCid?: string
  category: string
  customCategory?: string
  isVirtual: boolean
  isFree: boolean
  price: number
  currency: string
  ticketType: string
  unlimitedCapacity: boolean
  capacity?: number
  ticketsSold?: number
  organizerId?: any
  organizerWallet: string
  isOnChain: boolean
  status: string
  isActive: boolean
  createdAt: string | Date
  updatedAt: string | Date
}

// ==================== CONSTANTS ====================
const CATEGORIES = [
  { value: 'all', label: 'All Events', icon: '🎉', color: 'bg-gradient-to-r from-purple-500 to-pink-500' },
  { value: 'music', label: 'Music & Concerts', icon: '🎵', color: 'bg-gradient-to-r from-pink-500 to-rose-500' },
  { value: 'business', label: 'Business & Tech', icon: '💼', color: 'bg-gradient-to-r from-blue-500 to-cyan-500' },
  { value: 'arts', label: 'Arts & Culture', icon: '🎨', color: 'bg-gradient-to-r from-yellow-500 to-orange-500' },
  { value: 'sports', label: 'Sports & Fitness', icon: '⚽', color: 'bg-gradient-to-r from-green-500 to-emerald-500' },
  { value: 'food', label: 'Food & Drink', icon: '🍽️', color: 'bg-gradient-to-r from-red-500 to-orange-500' },
  { value: 'conference', label: 'Conferences', icon: '🎓', color: 'bg-gradient-to-r from-indigo-500 to-purple-500' },
  { value: 'festival', label: 'Festivals & Fairs', icon: '🎪', color: 'bg-gradient-to-r from-orange-500 to-red-500' },
  { value: 'other', label: 'Other', icon: '✨', color: 'bg-gradient-to-r from-gray-500 to-gray-700' },
]

// ==================== HELPER FUNCTIONS ====================
function getCategoryInfo(category: string) {
  const cat = CATEGORIES.find(c => c.value === category)
  return cat || CATEGORIES[0]
}

function areTicketsAvailable(event: Event): boolean {
  const eventEnd = event.endDateTime ? new Date(event.endDateTime) : new Date(event.endDate)
  return eventEnd > new Date()
}

function getEventStatus(event: Event): 'upcoming' | 'ongoing' | 'past' {
  const now = new Date()
  const start = event.startDateTime ? new Date(event.startDateTime) : new Date(event.startDate)
  const end = event.endDateTime ? new Date(event.endDateTime) : new Date(event.endDate)
  
  if (now > end) return 'past'
  if (now >= start && now <= end) return 'ongoing'
  return 'upcoming'
}

function formatDateHelper(dateString: string | Date) {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return 'Date TBD'
  }
}

function formatTimeHelper(dateString: string | Date) {
  try {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Time TBD'
  }
}

function getRemainingTickets(event: Event): number | string {
  if (event.unlimitedCapacity) return 'Unlimited'
  const total = event.capacity || 0
  const sold = event.ticketsSold || 0
  const remaining = total - sold
  return Math.max(0, remaining)
}

function getSoldPercentage(event: Event): number {
  if (event.unlimitedCapacity || !event.capacity) return 0
  const total = event.capacity
  const sold = event.ticketsSold || 0
  return (sold / total) * 100
}

// ✅ Copied verbatim from app/events/[id]/page.tsx
const getWalletAddress = (user: any): string | null => {
  if (!user) return null
  if (user.wallet?.address) return user.wallet.address
  const linkedAccounts = user.linkedAccounts || []
  for (const account of linkedAccounts) {
    if (account.type === 'wallet' && account.address) return account.address
  }
  return null
}

// ✅ Copied verbatim from app/events/[id]/page.tsx
let emailCache: { [key: string]: string } = {}
const fetchUserEmailByWallet = async (wallet: string): Promise<string | null> => {
  if (emailCache[wallet]) return emailCache[wallet]
  
  try {
    const res = await fetch(`/api/auth/user?walletAddress=${wallet}`)
    if (!res.ok) return null
    const data = await res.json()
    const email = data.user?.email || null
    if (email) emailCache[wallet] = email
    return email
  } catch (error) {
    console.error('Failed to fetch user email:', error)
    return null
  }
}

// ==================== EVENT CARD COMPONENT ====================
function EventCard({ event, isOrganizer = false }: { event: Event; isOrganizer?: boolean }) {
  const categoryInfo = getCategoryInfo(event.category)
  const ticketsAvailable = areTicketsAvailable(event)
  const eventStatus = getEventStatus(event)
  const eventDate = new Date(event.startDate)
  const eventTime = new Date(event.startDateTime || event.startDate)
  const remainingTickets = getRemainingTickets(event)
  const soldPercentage = getSoldPercentage(event)
  const isAlmostSoldOut = !event.unlimitedCapacity && soldPercentage >= 80 && soldPercentage < 100
  const isSoldOut = !event.unlimitedCapacity && soldPercentage >= 100

  const imageUrl = event.imageCid 
    ? `https://gateway.pinata.cloud/ipfs/${event.imageCid}`
    : event.bannerImage || '/placeholder-event.jpg'

  return (
    <div className="card group hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
      <div className="relative h-48 overflow-hidden rounded-t-2xl">
        <img
          src={imageUrl}
          alt={event.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/placeholder-event.jpg'
          }}
        />
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
        
        <div className="absolute top-3 left-3">
          <span className={`px-3 py-1.5 text-white text-xs font-bold rounded-full backdrop-blur-md ${categoryInfo.color}`}>
            {categoryInfo.icon} {event.customCategory || categoryInfo.label}
          </span>
        </div>
        
        {event.isVirtual && (
          <div className="absolute top-3 right-3">
            <span className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-bold rounded-full backdrop-blur-md flex items-center gap-1">
              <Globe className="h-3 w-3" />
              Virtual
            </span>
          </div>
        )}
        
        {isSoldOut && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white text-xl font-bold rounded-xl shadow-2xl rotate-12">
              SOLD OUT
            </span>
          </div>
        )}
        
        <div className="absolute bottom-3 left-3">
          <span className={`px-4 py-2 text-white text-sm font-bold rounded-xl shadow-xl flex items-center gap-2 backdrop-blur-md ${
            event.isFree 
              ? 'bg-gradient-to-r from-green-500 to-emerald-600' 
              : 'bg-gradient-to-r from-blue-500 to-purple-600'
          }`}>
            {event.isFree ? (
              <>
                <span className="text-lg">🎫</span>
                <span className="font-black">FREE</span>
              </>
            ) : (
              <>
                <span className="text-lg">💰</span>
                <span className="font-black">{event.currency} {event.price.toLocaleString()}</span>
              </>
            )}
          </span>
        </div>
        
        {eventStatus === 'past' && (
          <div className="absolute bottom-3 right-3">
            <span className="px-3 py-1.5 bg-gradient-to-r from-gray-600 to-gray-700 text-white text-xs font-bold rounded-full backdrop-blur-md flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Past
            </span>
          </div>
        )}
        {eventStatus === 'ongoing' && (
          <div className="absolute bottom-3 right-3">
            <span className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-bold rounded-full backdrop-blur-md flex items-center gap-1">
              <span className="relative flex h-2 w-2 mr-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              Live Now
            </span>
          </div>
        )}
      </div>

      <div className="p-5">
        <h3 className="font-bold text-lg mb-2 line-clamp-1 group-hover:text-primary transition-colors">
          {event.title}
        </h3>
        
        <p className="text-text-light text-sm mb-4 line-clamp-2">
          {event.description || 'An amazing event awaits!'}
        </p>

        <div className="space-y-3 mb-5">
          <div className="flex items-center text-text">
            <Calendar className="h-4 w-4 text-text-light mr-2 flex-shrink-0" />
            <div className="text-sm">
              <div className="font-medium">{formatDateHelper(eventDate)}</div>
              <div className="text-text-light text-xs">{formatTimeHelper(eventTime)}</div>
            </div>
          </div>
          
          <div className="flex items-center text-text">
            <MapPin className="h-4 w-4 text-text-light mr-2 flex-shrink-0" />
            <span className="text-sm truncate">
              {event.venue || event.location?.address || 'Location TBA'}
            </span>
          </div>
          
          {ticketsAvailable && !isSoldOut && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center text-text">
                  <Users className="h-4 w-4 text-text-light mr-2 flex-shrink-0" />
                  {isOrganizer ? (
                    // ✅ Organizer: exact numbers
                    <span className="font-medium">
                      {remainingTickets === 'Unlimited' 
                        ? 'Unlimited tickets' 
                        : `${remainingTickets} of ${event.capacity} left`
                      }
                    </span>
                  ) : (
                    // ✅ Public: only "Available" — no numbers
                    <span className="font-medium text-green-600 dark:text-green-400">
                      Available
                    </span>
                  )}
                </div>
                {isOrganizer && isAlmostSoldOut && !event.unlimitedCapacity && (
                  <div className="flex items-center gap-1 text-orange-500 text-xs font-semibold">
                    <TrendingDown className="h-3 w-3" />
                    Almost sold out!
                  </div>
                )}
              </div>
              
              {/* ✅ Progress bar visible only to organizer */}
              {isOrganizer && !event.unlimitedCapacity && event.capacity && (
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      isAlmostSoldOut 
                        ? 'bg-gradient-to-r from-orange-500 to-red-500' 
                        : 'bg-gradient-to-r from-primary to-purple-600'
                    }`}
                    style={{ width: `${Math.min(soldPercentage, 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Link
            href={`/events/${event._id}`}
            className={`flex-1 py-3 text-center text-sm rounded-xl font-medium transition-all ${
              (!ticketsAvailable || isSoldOut) && eventStatus !== 'past'
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'btn-primary'
            }`}
          >
            {(!ticketsAvailable || isSoldOut) && eventStatus !== 'past' ? 'Sold Out' : 'View Details'}
          </Link>
          {ticketsAvailable && !isSoldOut && eventStatus !== 'past' && (
            <Link
              href={`/events/${event._id}`}
              className="btn-outline flex-1 py-3 text-center text-sm"
            >
              Get Tickets
            </Link>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between text-xs text-text-light">
            <span>🎫 {event.ticketType}</span>
            <div className="flex items-center gap-3">
              {event.isOnChain && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  On-chain
                </span>
              )}
                {isOrganizer && !event.unlimitedCapacity && event.ticketsSold !== undefined && event.ticketsSold > 0 && (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {event.ticketsSold} sold
                  </span>
                )}
              
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== MAIN PAGE COMPONENT ====================
export default function EventsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, authenticated, ready } = usePrivy()
  const isInitialMount = useRef(true)

  // ✅ Same derivation as app/events/[id]/page.tsx
  const walletAddress = getWalletAddress(user)
  const isLoggedIn = authenticated && ready

  const [userEmail, setUserEmail] = useState<string | null>(null)
  
  const [events, setEvents] = useState<Event[]>([])
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all')
  const [priceFilter, setPriceFilter] = useState<'all' | 'free' | 'paid'>(
    (searchParams.get('price') as 'all' | 'free' | 'paid') || 'all'
  )
  const [dateFilter, setDateFilter] = useState<'all' | 'upcoming' | 'past'>(
    (searchParams.get('date') as 'all' | 'upcoming' | 'past') || 'upcoming'
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalEvents, setTotalEvents] = useState(0)
  const itemsPerPage = 12

  const fetchEvents = useCallback(async (page = 1, refresh = false) => {
    try {
      if (page === 1) {
        setIsLoading(true)
      } else {
        setIsLoadingMore(true)
      }

      const params = new URLSearchParams({
        page: page.toString(),
        limit: itemsPerPage.toString(),
        category: selectedCategory !== 'all' ? selectedCategory : '',
        priceType: priceFilter !== 'all' ? priceFilter : '',
        dateType: dateFilter !== 'all' ? dateFilter : '',
        search: search || '',
      })

      console.log('🔍 Fetching events with dateType:', dateFilter)
      
      const response = await fetch(`/api/events?${params}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch events')
      }

      const data = await response.json()
      
      let fetchedEvents: Event[] = []
      let total = 0
      let pages = 1
      
      if (data.success && data.events && Array.isArray(data.events)) {
        fetchedEvents = data.events
        total = data.total || data.events.length
        pages = data.totalPages || Math.ceil(total / itemsPerPage)
        
        console.log(`📊 API returned ${fetchedEvents.length} events for dateType=${dateFilter}`)
      }
      
      if (refresh || page === 1) {
        setEvents(fetchedEvents)
      } else {
        setEvents(prev => [...prev, ...fetchedEvents])
      }
      
      setTotalPages(pages)
      setTotalEvents(total)
      setCurrentPage(page)
      
    } catch (error) {
      console.error('Error fetching events:', error)
      toast.error('Failed to load events. Please try again.')
      setEvents([])
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [selectedCategory, priceFilter, dateFilter, search])

  // ✅ Copied verbatim from app/events/[id]/page.tsx
  // Fetch logged-in user's email - delayed to not block render
  useEffect(() => {
    const fetchUserEmail = async () => {
      if (!isLoggedIn || !walletAddress) return

      setTimeout(async () => {
        try {
          const email = await fetchUserEmailByWallet(walletAddress)
          if (email) setUserEmail(email)
        } catch (error) {
          console.error('Error fetching user email:', error)
        }
      }, 200)
    }
    fetchUserEmail()
  }, [isLoggedIn, walletAddress])

    // ✅ Same pattern as [id]/page.tsx: fetch organizer email by wallet,
  // then compare against the current user's email.
  // Runs when events load or when the user's email becomes available.
  const [organizerEmails, setOrganizerEmails] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!userEmail || events.length === 0) return

    let cancelled = false

    const resolveOrganizers = async () => {
      const result = { ...organizerEmails }
      const wallets = Array.from(
        new Set(
          events
            .map((e) => e.organizerWallet)
            .filter((w): w is string => !!w)
        )
      )

      for (const wallet of wallets) {
        if (result[wallet] !== undefined) continue
        // ✅ Uses the exact same helper as [id]/page.tsx
        result[wallet] = await fetchUserEmailByWallet(wallet)
      }

      if (!cancelled) setOrganizerEmails(result)
    }

    resolveOrganizers()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, userEmail])

  // Update URL when filters change (but don't trigger fetch on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (selectedCategory !== 'all') params.set('category', selectedCategory)
    if (priceFilter !== 'all') params.set('price', priceFilter)
    if (dateFilter !== 'all') params.set('date', dateFilter)
    
    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
    router.replace(newUrl, { scroll: false })
  }, [search, selectedCategory, priceFilter, dateFilter, router])

  // Fetch events when filters change - ONLY when not initial mount
  useEffect(() => {
    if (!isInitialMount.current) {
      setCurrentPage(1)
      fetchEvents(1, true)
    }
  }, [selectedCategory, priceFilter, dateFilter, search, fetchEvents])

  // Initial fetch on mount
  useEffect(() => {
    fetchEvents(1, true)
  }, []) // Empty dependency array - runs once on mount

  const loadMore = () => {
    if (currentPage < totalPages && !isLoadingMore) {
      fetchEvents(currentPage + 1)
    }
  }

  const resetFilters = () => {
    setSelectedCategory('all')
    setPriceFilter('all')
    setDateFilter('upcoming')
    setSearch('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="responsive-container py-8 md:py-12" id="events-grid">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-text mb-4 bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            Discover Amazing Events
          </h1>
          <p className="text-text-light text-lg max-w-2xl mx-auto">
            Find and book tickets for the best events happening near you
          </p>
        </div>

        <div className="mb-12">
          <div className="flex flex-col lg:flex-row gap-6 mb-8">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-text-light h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search events, venues, or organizers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input-field pl-12 pr-4 py-4 text-lg shadow-lg w-full"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetFilters}
                className="px-6 py-4 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 shadow-sm"
              >
                <Filter className="h-5 w-5" />
                Reset
              </button>
              <Link
                href="/dashboard/create-ticket"
                className="btn-primary px-6 py-4 flex items-center gap-2"
              >
                <Ticket className="h-5 w-5" />
                Create Event
              </Link>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text-light mb-4">Categories</h3>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.value}
                    onClick={() => setSelectedCategory(category.value)}
                    className={`px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${
                      selectedCategory === category.value
                        ? `${category.color} text-white shadow-lg`
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    <span>{category.icon}</span>
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm">
              <div>
                <h3 className="text-sm font-semibold text-text-light mb-3">Price Type</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPriceFilter('all')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      priceFilter === 'all'
                        ? 'bg-primary text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setPriceFilter('free')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      priceFilter === 'free'
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    Free
                  </button>
                  <button
                    onClick={() => setPriceFilter('paid')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      priceFilter === 'paid'
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    Paid
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-text-light mb-3">Date</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDateFilter('all')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      dateFilter === 'all'
                        ? 'bg-primary text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setDateFilter('upcoming')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      dateFilter === 'upcoming'
                        ? 'bg-primary text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    Upcoming
                  </button>
                  <button
                    onClick={() => setDateFilter('past')}
                    className={`px-4 py-3 rounded-xl font-medium capitalize transition-all ${
                      dateFilter === 'past'
                        ? 'bg-primary text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md'
                    }`}
                  >
                    Past
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-primary animate-spin-slow flex items-center justify-center">
              <Ticket className="h-8 w-8 text-white" />
            </div>
            <p className="text-text-light text-lg">Loading amazing events...</p>
          </div>
        ) : events.length > 0 ? (
          <>
            <div className="mb-8">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-text">
                    {selectedCategory !== 'all' 
                      ? `${getCategoryInfo(selectedCategory).label} Events`
                      : 'All Events'
                    }
                  </h2>
                  <p className="text-text-light mt-1">
                    {totalEvents} {totalEvents === 1 ? 'event' : 'events'} found
                  </p>
                </div>
                <div className="text-sm text-text-light bg-white dark:bg-gray-800 px-4 py-2 rounded-xl shadow-sm">
                  Page {currentPage} of {totalPages}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12">
              {events.map((event) => {
                // ✅ Identical comparison to app/events/[id]/page.tsx
                const organizerEmail = event.organizerWallet
                  ? organizerEmails[event.organizerWallet]
                  : null
                const isOrganizer =
                  !!userEmail && !!organizerEmail && organizerEmail === userEmail

                return (
                  <EventCard
                    key={event._id}
                    event={event}
                    isOrganizer={isOrganizer}
                  />
                )
              })}
            </div>

            {currentPage < totalPages && (
              <div className="text-center mb-12">
                <button
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="btn-primary px-8 py-4 text-lg flex items-center gap-2 mx-auto"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      Load More Events
                      <ChevronRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-white dark:bg-gray-800 rounded-2xl shadow-sm">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-primary/10 flex items-center justify-center">
              <Ticket className="h-12 w-12 text-primary" />
            </div>
            <h3 className="text-2xl font-bold text-text mb-3">No events found</h3>
            <p className="text-text-light mb-8 max-w-md mx-auto">
              {search 
                ? `No events match "${search}". Try a different search or browse all events.`
                : 'No events match your current filters. Try adjusting your criteria.'
              }
            </p>
            <button
              onClick={resetFilters}
              className="btn-primary px-6 py-3"
            >
              Reset Filters
            </button>
          </div>
        )}

        <div className="mt-16 bg-gradient-to-r from-primary/10 to-purple-600/10 rounded-2xl p-8 md:p-12 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-primary"></div>
          <div className="max-w-3xl mx-auto text-center relative z-10">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-primary/20 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-3xl font-bold text-text mb-4">Ready to Host Your Event?</h2>
            <p className="text-text-light text-lg mb-8">
              Join thousands of organizers who trust CACKPass to create, manage, and monetize their events.
              Start your journey today!
            </p>
            <Link
              href="/dashboard/create-ticket"
              className="btn-primary px-8 py-4 text-lg inline-flex items-center gap-3"
            >
              <Ticket className="h-6 w-6" />
              Create Your First Event
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}