// app/events/[id]/page.tsx
'use client'

import { useState, useEffect, Suspense, lazy, memo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { 
  Calendar, MapPin, Clock, Users, Ticket, 
  Heart, ChevronLeft, Tag, Globe, Shield, 
  QrCode, Loader2, CreditCard, Wallet, 
  CheckCircle, AlertCircle, User, Mail, 
  Settings, Percent, X, Star, Share2, AtSign
} from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { usePrivy } from '@privy-io/react-auth'
import { format } from 'date-fns'

// Lazy load heavy components
const LoadingSpinner = dynamic(() => 
  import('@/components/common/LoadingSpinner').then(mod => ({ default: mod.LoadingSpinner })),
  { ssr: false }
)

const ShareDropdown = dynamic(() => 
  import('@/components/common/ShareDropdown').then(mod => ({ default: mod.default })),
  { ssr: false, loading: () => <button className="p-2 hover:bg-gray-100 rounded-lg"><Share2 className="h-5 w-5 text-gray-400" /></button> }
)

declare global {
  interface Window {
    FlutterwaveCheckout: (config: any) => void;
  }
}

// Skeleton components for better UX
const EventHeaderSkeleton = () => (
  <div className="relative h-64 md:h-80 lg:h-96 bg-gray-200 dark:bg-gray-700 animate-pulse">
    <div className="absolute bottom-0 left-0 right-0 p-6">
      <div className="container mx-auto max-w-6xl">
        <div className="h-8 w-3/4 bg-gray-300 dark:bg-gray-600 rounded mb-4"></div>
        <div className="h-4 w-1/2 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
    </div>
  </div>
)

const TicketCardSkeleton = () => (
  <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
    <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4 animate-pulse"></div>
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className="p-5 rounded-xl border-2 border-gray-200">
          <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2 animate-pulse"></div>
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  </div>
)

interface TicketTypeData {
  _id: string
  name: string
  description?: string
  category: string
  price: number
  maxSupply: number
  currentSupply: number
  isActive: boolean
  eventId: string
}

interface EventDataWithId {
  id: string
  _id?: string
  title: string
  description: string
  startDate: string
  endDate: string
  venue: string
  location: { address?: string; lat?: number; lng?: number }
  isVirtual: boolean
  isFree: boolean
  price: number
  currency: string
  category: string
  imageCid?: string
  bannerImage?: string
  ticketType: string
  unlimitedCapacity: boolean
  capacity?: number
  ticketsSold?: number
  organizerWallet: string
  organizer: { name: string; avatar: string; _id?: string }
  attendees: number
  rating: number
}

interface DiscountCode {
  _id: string
  code: string
  discountPercent: number
  maxUses: number
  usedCount: number
  expiresAt: string | null
  isActive: boolean
}

const DEFAULT_ORGANIZER = { name: 'Event Organizer', avatar: '/cackpas.jpg' }

const getSafeOrganizer = (organizer?: { name?: string; avatar?: string }) => {
  if (!organizer) return DEFAULT_ORGANIZER
  return { name: organizer.name || DEFAULT_ORGANIZER.name, avatar: organizer.avatar || DEFAULT_ORGANIZER.avatar }
}

const getSafeAvatarUrl = (avatar?: string) => {
  if (!avatar || avatar.trim() === '') return '/cackpas.jpg'
  if (avatar.startsWith('http') || avatar.startsWith('/')) return avatar
  return `/${avatar}`
}

// ✅ Availability label for non-organizer viewers
// Shows "Available" when stock > 0, "Sold Out" when stock = 0
// Organizers see the exact numeric breakdown separately.
const getPublicAvailabilityLabel = (available: number | 'Unlimited'): string => {
  if (available === 'Unlimited') return 'Available'
  return available > 0 ? 'Available' : 'Sold Out'
}

// Helper functions
const getWalletAddress = (user: any): string | null => {
  if (!user) return null
  if (user.wallet?.address) return user.wallet.address
  const linkedAccounts = user.linkedAccounts || []
  for (const account of linkedAccounts) {
    if (account.type === 'wallet' && account.address) return account.address
  }
  return null
}

// Memoized email fetch with cache
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

const isValidObjectId = (id: string): boolean => /^[0-9a-fA-F]{24}$/.test(id)

// Memoized DiscountModal component
const DiscountModal = memo(({ 
  show, 
  onClose, 
  eventId, 
  existingDiscounts, 
  isLoading, 
  formData, 
  setFormData, 
  onSubmit, 
  isCreating 
}: any) => {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Manage Discount Codes</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Existing Discounts</h3>
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          ) : existingDiscounts.length === 0 ? (
            <p className="text-gray-500 text-sm">No discounts created yet.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {existingDiscounts.map((discount: DiscountCode) => (
                <div key={discount._id} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div>
                    <span className="font-mono font-bold">{discount.code}</span>
                    <span className="ml-2 text-sm">({discount.discountPercent}% off)</span>
                    <div className="text-xs text-gray-500">Used: {discount.usedCount}/{discount.maxUses}</div>
                  </div>
                  {discount.expiresAt && (
                    <span className="text-xs text-gray-400">
                      Expires: {new Date(discount.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Discount Code</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="e.g., EARLYBIRD"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Discount Percent (%)</label>
            <input
              type="number"
              value={formData.discountPercent}
              onChange={(e) => setFormData({ ...formData, discountPercent: parseInt(e.target.value) })}
              min="1"
              max="100"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max Uses</label>
            <input
              type="number"
              value={formData.maxUses}
              onChange={(e) => setFormData({ ...formData, maxUses: parseInt(e.target.value) })}
              min="1"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expiry Date (optional)</label>
            <input
              type="date"
              value={formData.expiresAt}
              onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="w-full py-2 bg-primary text-white rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {isCreating ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : 'Create Discount Code'}
          </button>
        </form>
      </div>
    </div>
  )
})

DiscountModal.displayName = 'DiscountModal'

export default function EventPage() {
  return (
    <Suspense fallback={<LoadingSpinner fullScreen text="Loading event..." />}>
      <EventPageContent />
    </Suspense>
  )
}

function EventPageContent() {
  const params = useParams()
  const router = useRouter()
  const { user, authenticated, ready, login } = usePrivy()
  
  const [event, setEvent] = useState<EventDataWithId | null>(null)
  const [ticketTypes, setTicketTypes] = useState<TicketTypeData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const [selectedTicketType, setSelectedTicketType] = useState<TicketTypeData | null>(null)
  const [imageError, setImageError] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [isGettingFreeTicket, setIsGettingFreeTicket] = useState(false)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'flutterwave' | 'crypto'>('flutterwave')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isFetchingEmail, setIsFetchingEmail] = useState(false)
  const [isOrganizer, setIsOrganizer] = useState(false)
  const [flutterwaveLoaded, setFlutterwaveLoaded] = useState(false);
  
  // Guest checkout state
  const [guestEmail, setGuestEmail] = useState('')
  const [guestEmailError, setGuestEmailError] = useState<string>('')
  const [showGuestEmailModal, setShowGuestEmailModal] = useState(false)
  const [isSubmittingGuestEmail, setIsSubmittingGuestEmail] = useState(false)
  
  // Discount management state
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [existingDiscounts, setExistingDiscounts] = useState<DiscountCode[]>([])
  const [isLoadingDiscounts, setIsLoadingDiscounts] = useState(false)
  const [discountFormData, setDiscountFormData] = useState({
    code: '',
    discountPercent: 15,
    maxUses: 15,
    expiresAt: '',
  })
  const [isCreatingDiscount, setIsCreatingDiscount] = useState(false)

  // User discount code state
  const [discountCode, setDiscountCode] = useState('')
  const [appliedDiscount, setAppliedDiscount] = useState<{ percent: number; amount: number; codeId: string } | null>(null)
  const [isVerifyingDiscount, setIsVerifyingDiscount] = useState(false)

  const eventId = params.id as string
  const walletAddress = getWalletAddress(user)
  const isLoggedIn = authenticated && ready

  useEffect(() => {
  // Load Flutterwave script only once
  if (!document.querySelector('script[src*="checkout.flutterwave.com/v3.js"]')) {
    const script = document.createElement('script');
    script.src = 'https://checkout.flutterwave.com/v3.js';
    script.async = true;
    script.onload = () => {
      console.log('✅ Flutterwave script loaded');
      setFlutterwaveLoaded(true);
    };
    script.onerror = () => {
      console.error('❌ Failed to load Flutterwave script');
      toast.error('Payment service loading failed. Please refresh and try again.');
    };
    document.body.appendChild(script);
  } else {
    setFlutterwaveLoaded(true);
  }
}, []);

  // Fetch logged-in user's email - delayed to not block render
  useEffect(() => {
    const fetchUserEmail = async () => {
      if (!isLoggedIn || !walletAddress) return
      
      // Delay email fetch to prioritize event data
      setTimeout(async () => {
        setIsFetchingEmail(true)
        try {
          const email = await fetchUserEmailByWallet(walletAddress)
          if (email) setUserEmail(email)
        } catch (error) {
          console.error('Error fetching user email:', error)
        } finally {
          setIsFetchingEmail(false)
        }
      }, 200)
    }
    fetchUserEmail()
  }, [isLoggedIn, walletAddress])

  // Fetch event data
  useEffect(() => {
    const fetchEventData = async () => {
      if (!eventId) return
      try {
        setIsLoading(true)
        
        // Fetch event and tickets in parallel
        const [eventResponse, ticketsResponse] = await Promise.all([
          fetch(`/api/events/${eventId}`),
          fetch(`/api/events/${eventId}/tickets`)
        ])
        
        if (!eventResponse.ok) throw new Error('Failed to fetch event')
        const eventData = await eventResponse.json()
        if (!eventData.success || !eventData.event) throw new Error('Event not found')
        
        const transformedEvent = {
          ...eventData.event,
          id: eventData.event._id || eventData.event.id,
          _id: eventData.event._id,
          organizerWallet: eventData.event.organizerWallet,
          organizer: getSafeOrganizer(eventData.event.organizer)
        }
        setEvent(transformedEvent)
        
        if (ticketsResponse.ok) {
          const ticketsData = await ticketsResponse.json()
          const ticketTypesList = ticketsData.ticketTypes || []
          setTicketTypes(ticketTypesList)
          if (ticketTypesList.length > 0) setSelectedTicketType(ticketTypesList[0])
        }
        
        // Check favorites from localStorage
        const favorites = JSON.parse(localStorage.getItem('cackpass_favorites') || '[]')
        setIsFavorite(favorites.includes(eventId))
      } catch (error) {
        console.error('Error loading event:', error)
        toast.error('Failed to load event details')
        router.push('/events')
      } finally {
        setIsLoading(false)
      }
    }
    fetchEventData()
  }, [eventId, router])

  // Check if user is organizer - delayed
  useEffect(() => {
    const checkOrganizer = async () => {
      if (!event || !userEmail) return
      
      setTimeout(async () => {
        try {
          const organizerEmail = await fetchUserEmailByWallet(event.organizerWallet)
          setIsOrganizer(organizerEmail === userEmail)
        } catch (error) {
          console.error('Failed to check organizer status:', error)
          setIsOrganizer(false)
        }
      }, 300)
    }
    checkOrganizer()
  }, [event, userEmail])

    // ✅ Reset guest email error when the modal opens/closes
  useEffect(() => {
    if (showGuestEmailModal) {
      // Fresh open — clear error, keep typed email if re-opened
      setGuestEmailError('')
    } else {
      // Modal closed — fully reset
      setGuestEmail('')
      setGuestEmailError('')
    }
  }, [showGuestEmailModal])

  // Fetch discounts with validation
  const fetchDiscounts = useCallback(async () => {
    if (!eventId || !isValidObjectId(eventId)) {
      toast.error('Invalid event ID. Cannot load discounts.')
      return
    }
    setIsLoadingDiscounts(true)
    try {
      const res = await fetch(`/api/events/${eventId}/discounts`)
      const data = await res.json()
      if (res.ok) setExistingDiscounts(data.discounts || [])
      else toast.error(data.error || 'Failed to load discounts')
    } catch (error) {
      console.error('Error fetching discounts:', error)
      toast.error('Network error while loading discounts')
    } finally {
      setIsLoadingDiscounts(false)
    }
  }, [eventId])

  const handleOpenDiscountModal = useCallback(() => {
    if (!eventId || !isValidObjectId(eventId)) {
      toast.error('Event ID is invalid. Cannot manage discounts.')
      return
    }
    setDiscountFormData({
      code: '',
      discountPercent: 15,
      maxUses: 15,
      expiresAt: '',
    })
    fetchDiscounts()
    setShowDiscountModal(true)
  }, [eventId, fetchDiscounts])

  const handleCreateDiscount = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!eventId || !isValidObjectId(eventId)) {
      toast.error('Invalid event ID. Cannot create discount.')
      return
    }
    if (!discountFormData.code.trim()) {
      toast.error('Discount code is required')
      return
    }
    setIsCreatingDiscount(true)
    try {
      const res = await fetch(`/api/events/${eventId}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: discountFormData.code.toUpperCase(),
          discountPercent: discountFormData.discountPercent,
          maxUses: discountFormData.maxUses,
          expiresAt: discountFormData.expiresAt || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create discount')
      toast.success('Discount code created successfully')
      setDiscountFormData({
        code: '',
        discountPercent: 15,
        maxUses: 15,
        expiresAt: '',
      })
      fetchDiscounts()
    } catch (error: any) {
      console.error('Create discount error:', error)
      toast.error(error.message)
    } finally {
      setIsCreatingDiscount(false)
    }
  }, [eventId, discountFormData, fetchDiscounts])

  const applyDiscount = useCallback(async () => {
    if (!discountCode.trim() || !selectedTicketType) return
    setIsVerifyingDiscount(true)
    try {
      const res = await fetch('/api/discount/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: discountCode,
          eventId,
          quantity: selectedQuantity,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const discountAmount = (selectedTicketType.price * selectedQuantity * data.discountPercent) / 100
      setAppliedDiscount({
        percent: data.discountPercent,
        amount: discountAmount,
        codeId: data.codeId,
      })
      toast.success(`${data.discountPercent}% discount applied!`)
    } catch (err: any) {
      toast.error(err.message)
      setAppliedDiscount(null)
    } finally {
      setIsVerifyingDiscount(false)
    }
  }, [discountCode, selectedTicketType, eventId, selectedQuantity])

  const handleGetFreeTicket = useCallback(async () => {
    // For free tickets, we still need an email
    if (!userEmail && !guestEmail) {
      setShowGuestEmailModal(true)
      return
    }
    
    const emailToUse = userEmail || guestEmail
    
    try {
      setIsGettingFreeTicket(true)
      
      // Get the authentication token from Privy if available
      let authToken = null
      
      if (typeof window !== 'undefined' && (window as any).privy?.getAccessToken) {
        try {
          authToken = await (window as any).privy.getAccessToken()
          console.log('🔐 Got token from window.privy.getAccessToken()')
        } catch (e) {
          console.log('Could not get token from window.privy')
        }
      }
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
        console.log('🔐 [FREE] Sending request with auth token')
      }
      
      const response = await fetch('/api/tickets/free', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          eventId: eventId,
          quantity: selectedQuantity,
          userEmail: emailToUse,
          userName: emailToUse.split('@')[0] || 'User',
          isGuest: !userEmail
        })
      })
      
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to get free ticket')
      
      if (data.success) {
        toast.success('Free ticket created successfully! Redirecting...')
        setTimeout(() => {
          router.push(`/payment/success?reference=${data.ticket?.id || 'free-ticket'}&free=true&email=${encodeURIComponent(emailToUse)}`)
        }, 1500)
      }
    } catch (error) {
      console.error('Error getting free ticket:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to get free ticket')
    } finally {
      setIsGettingFreeTicket(false)
    }
  }, [userEmail, guestEmail, eventId, selectedQuantity, router])

  // Updated handlePayWithCard to accept optional email parameter
const handlePayWithCard = useCallback(async (overrideEmail?: string) => {
  const emailToUse = overrideEmail || userEmail || guestEmail;
  
  if (!emailToUse) {
    setShowGuestEmailModal(true);
    return;
  }
  
  if (!selectedTicketType) {
    toast.error('Please select a ticket type');
    return;
  }
  
  let totalPrice = selectedTicketType.price * selectedQuantity;
  let discountCodeValue = discountCode.trim();
  let discountPercent = 0;
  let discountAmountValue = 0;

  if (appliedDiscount) {
    discountPercent = appliedDiscount.percent;
    discountAmountValue = appliedDiscount.amount;
    totalPrice = totalPrice - discountAmountValue;
  }

  try {
    setIsProcessingPayment(true);
    
    const response = await fetch('/api/payments/flutterwave/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        ticketTypeId: selectedTicketType._id,
        quantity: selectedQuantity,
        amount: totalPrice,
        originalAmount: selectedTicketType.price * selectedQuantity,
        email: emailToUse,
        userName: emailToUse.split('@')[0] || 'User',
        discountCode: discountCodeValue,
        discountPercent,
        discountAmount: discountAmountValue,
        isGuest: !userEmail,
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to initialize payment');
    }
    
    // Use inline modal instead of redirect
    if (data.success && data.transaction) {
      // Check if Flutterwave is loaded
      if (typeof window !== 'undefined' && window.FlutterwaveCheckout) {
        // Open the inline modal
        window.FlutterwaveCheckout({
          public_key: process.env.NEXT_PUBLIC_FLW_PUBLIC_KEY || 'FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxx-X',
          tx_ref: data.transaction.tx_ref,
          amount: data.transaction.amount,
          currency: data.transaction.currency || 'NGN',
          payment_options: 'card,ussd,banktransfer,account',
          meta: data.transaction.meta || {},
          customer: {
            email: data.transaction.customer.email,
            name: data.transaction.customer.name,
          },
          callback: function (response: any) {
            console.log('✅ Payment callback:', response);
            // Include the transaction_id in the redirect URL
            const redirectUrl = `/payment/success?reference=${data.reference}&provider=flutterwave&transaction_id=${response.transaction_id}`;
            window.location.href = redirectUrl;
          },

          onclose: function () {
            console.log('🔒 Payment modal closed');
            setIsProcessingPayment(false);
          },
          customizations: {
            title: 'CACK-pass',
            description: 'Event Ticket Purchase',
            logo: 'https://i.imgur.com/hWwzPMF.png', // 🚀 Verified direct image URL
          },
        });
      } else {
        // Fallback to redirect if modal not available
        console.warn('⚠️ Flutterwave modal not loaded, falling back to redirect');
        if (data.authorization_url) {
          window.location.href = data.authorization_url;
        } else {
          throw new Error('No payment method available');
        }
      }
    } else {
      // Fallback to redirect
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        throw new Error('No payment URL received');
      }
    }
  } catch (error) {
    console.error('❌ Payment error:', error);
    toast.error(error instanceof Error ? error.message : 'Failed to process payment');
    setIsProcessingPayment(false);
  }
}, [userEmail, guestEmail, selectedTicketType, selectedQuantity, discountCode, appliedDiscount, eventId]);

  const handlePayWithCrypto = useCallback(() => {
    toast.info('🚀 Crypto payments are coming soon! Stay tuned for updates.')
  }, [])


  // Handle guest email submission
  const handleGuestEmailSubmit = useCallback(async () => {
  if (!guestEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
    toast.error('Please enter a valid email address')
    return
  }
  
  setIsSubmittingGuestEmail(true)
  try {
    // Store the email in state
    setUserEmail(guestEmail)
    setShowGuestEmailModal(false)
    
    // Proceed with payment after a small delay to ensure state updates
    setTimeout(async () => {
      if (selectedPaymentMethod === 'flutterwave') {
        await handlePayWithCard(guestEmail)
      } else if (selectedPaymentMethod === 'crypto') {
        handlePayWithCrypto()
      } else {
        // Free ticket
        await handleGetFreeTicket()
      }
    }, 100)
  } catch (error) {
    console.error('Error with guest email:', error)
    toast.error('Failed to proceed with guest checkout')
  } finally {
    setIsSubmittingGuestEmail(false)
  }
}, [guestEmail, selectedPaymentMethod, handlePayWithCard, handlePayWithCrypto, handleGetFreeTicket])

  
  const handleTicketTypeSelect = useCallback((ticketType: TicketTypeData) => {
    setSelectedTicketType(ticketType)
    setSelectedQuantity(1)
  }, [])

  const handleQuantityChange = useCallback((change: number) => {
    if (!selectedTicketType || !event) return
    
    let maxAvailable = 10
    if (selectedTicketType._id.toString().startsWith('virtual_')) {
      if (!event.unlimitedCapacity) {
        maxAvailable = (event.capacity || 0) - (event.ticketsSold || 0)
      } else {
        maxAvailable = 10
      }
    } else {
      maxAvailable = selectedTicketType.maxSupply === 0 ? 10 : selectedTicketType.maxSupply - selectedTicketType.currentSupply
    }
    
    const newQuantity = selectedQuantity + change
    if (newQuantity < 1) {
      toast.error('Minimum quantity is 1')
      return
    }
    if (newQuantity > maxAvailable && maxAvailable > 0) {
      toast.error(`Only ${maxAvailable} tickets available`)
      return
    }
    setSelectedQuantity(newQuantity)
  }, [selectedTicketType, selectedQuantity, event])

  const handleFavoriteToggle = useCallback(() => {
    const favorites = JSON.parse(localStorage.getItem('cackpass_favorites') || '[]')
    if (isFavorite) {
      localStorage.setItem('cackpass_favorites', JSON.stringify(favorites.filter((id: string) => id !== eventId)))
      setIsFavorite(false)
      toast.success('Removed from favorites')
    } else {
      if (favorites.length >= 50) { 
        toast.error('Maximum 50 favorites allowed')
        return 
      }
      favorites.push(eventId)
      localStorage.setItem('cackpass_favorites', JSON.stringify(favorites))
      setIsFavorite(true)
      toast.success('Added to favorites')
    }
  }, [isFavorite, eventId])

  const formatDateTime = useCallback((dateString: string) => {
    if (!dateString) return 'Date TBD'
    try {
      const date = new Date(dateString)
      return format(date, 'MMM d, yyyy • h:mm a')
    } catch { 
      return 'Invalid date' 
    }
  }, [])

  const getImageUrl = useCallback(() => {
    if (imageError) return '/placeholder-event.jpg'
    if (event?.imageCid) return `https://gateway.pinata.cloud/ipfs/${event.imageCid}`
    if (event?.bannerImage?.startsWith('http')) return event.bannerImage
    return '/placeholder-event.jpg'
  }, [imageError, event])

  const getAvailableTickets = useCallback((ticketType: TicketTypeData) => {
    if (ticketType._id.toString().startsWith('virtual_') && event) {
      if (event.unlimitedCapacity) return 'Unlimited'
      const remaining = (event.capacity || 0) - (event.ticketsSold || 0)
      return Math.max(0, remaining)
    }
    if (ticketType.maxSupply === 0) return 'Unlimited'
    return Math.max(0, ticketType.maxSupply - ticketType.currentSupply)
  }, [event])

  const isTicketAvailable = useCallback((ticketType: TicketTypeData) => {
    if (ticketType._id.toString().startsWith('virtual_') && event) {
      if (event.unlimitedCapacity) return true
      const remaining = (event.capacity || 0) - (event.ticketsSold || 0)
      return remaining > 0
    }
    if (ticketType.maxSupply === 0) return true
    return ticketType.currentSupply < ticketType.maxSupply
  }, [event])

  const getTotalPrice = useCallback(() => {
    if (!selectedTicketType || event?.isFree) return '0.00'
    let price = selectedTicketType.price * selectedQuantity
    if (appliedDiscount) price = price - appliedDiscount.amount
    return price.toFixed(2)
  }, [selectedTicketType, selectedQuantity, appliedDiscount, event])

  const isPastEvent = event?.endDate ? new Date(event.endDate) < new Date() : false

  // Guest Email Modal
  // Guest Email Modal
  const GuestEmailModal = () => {
    // ✅ Live validation helper
    const validateEmail = (value: string): string => {
      if (!value.trim()) return 'Email is required'
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(value.trim())) return 'Please enter a valid email address'
      return ''
    }

    const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setGuestEmail(value)
      // Only show error after the user starts typing
      if (value.length > 0) {
        setGuestEmailError(validateEmail(value))
      } else {
        setGuestEmailError('')
      }
    }

    const handleBlur = () => {
      setGuestEmailError(validateEmail(guestEmail))
    }

    const handleSubmit = () => {
      const error = validateEmail(guestEmail)
      if (error) {
        setGuestEmailError(error)
        toast.error(error)
        return
      }
      handleGuestEmailSubmit()
    }

    const isEmailValid = validateEmail(guestEmail) === ''

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
        onClick={() => !isSubmittingGuestEmail && setShowGuestEmailModal(false)}
      >
        <div
          className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
              <AtSign className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Enter Your Email</h2>
            <p className="text-gray-600 dark:text-gray-400">
              We'll send your ticket confirmation to this email address
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="email"
                  value={guestEmail}
                  onChange={handleEmailChange}
                  onBlur={handleBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isEmailValid && !isSubmittingGuestEmail) {
                      handleSubmit()
                    }
                  }}
                  placeholder="you@example.com"
                  className={`w-full pl-12 pr-10 py-3 border rounded-xl dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 transition-colors ${
                    guestEmailError
                      ? 'border-red-500 focus:ring-red-500'
                      : isEmailValid && guestEmail.length > 0
                        ? 'border-green-500 focus:ring-green-500'
                        : 'focus:ring-primary'
                  }`}
                  disabled={isSubmittingGuestEmail}
                  autoFocus
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={!!guestEmailError}
                  aria-describedby="guest-email-error"
                />

                {/* ✅ Inline status icon */}
                {guestEmail.length > 0 && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    {guestEmailError ? (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                )}
              </div>

              {/* ✅ Inline error message */}
              {guestEmailError && (
                <p
                  id="guest-email-error"
                  className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1"
                >
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {guestEmailError}
                </p>
              )}

              {/* ✅ Success hint */}
              {!guestEmailError && guestEmail.length > 0 && (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  Email looks good
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowGuestEmailModal(false)}
                className="flex-1 py-3 border border-gray-300 dark:border-gray-600 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                disabled={isSubmittingGuestEmail}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmittingGuestEmail || !isEmailValid}
                className="flex-1 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
              >
                {isSubmittingGuestEmail ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
        <EventHeaderSkeleton />
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4 animate-pulse"></div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                  <div className="h-4 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                </div>
              </div>
              <TicketCardSkeleton />
            </div>
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4 animate-pulse"></div>
                <div className="h-12 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center p-8 max-w-md">
          <AlertCircle className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h2 className="text-2xl font-bold mb-2">Event Not Found</h2>
          <p className="text-gray-600 mb-6">The event you're looking for doesn't exist or has been removed.</p>
          <Link href="/events" className="btn-primary px-6 py-3 inline-flex items-center gap-2">
            <ChevronLeft className="h-4 w-4" /> Browse Events
          </Link>
        </div>
      </div>
    )
  }

  const organizer = getSafeOrganizer(event.organizer)
  const organizerAvatar = getSafeAvatarUrl(organizer.avatar)


  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      {/* Guest Email Modal */}
      {showGuestEmailModal && <GuestEmailModal />}

      {/* Back Navigation */}
      <div className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900">
              <ChevronLeft className="h-5 w-5" /> <span>Back</span>
            </button>
            <div className="flex items-center gap-3">
              <button onClick={handleFavoriteToggle} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <Heart className={`h-5 w-5 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
              </button>

              {isOrganizer && (
                <>
                                    {/* ✅ NEW: Attendees list button */}
                  <Link
                    href={`/dashboard/events/${eventId}/attendees`}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm"
                  >
                    <Users className="h-4 w-4" />
                    <span className="text-base font-medium">Attendees</span>
                  </Link>
                  <Link
                    href={`/dashboard/edit-event/${eventId}`}
                    className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-xl hover:bg-primary-dark transition-all shadow-sm"
                  >
                    <Settings className="h-4 w-4" />
                    <span className="text-base font-medium">Edit</span>
                  </Link>
                  <button
                    onClick={handleOpenDiscountModal}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all shadow-sm"
                  >
                    <Percent className="h-4 w-4" />
                    <span className="text-base font-medium">Discounts</span>
                  </button>
                </>
              )}

              <Suspense fallback={<button className="p-2"><Share2 className="h-5 w-5" /></button>}>
                <ShareDropdown 
                  url={`${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/events/${eventId}`}
                  title={event.title}
                  eventTitle={event.title}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      {/* Discount Modal */}
      <DiscountModal
        show={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        eventId={eventId}
        existingDiscounts={existingDiscounts}
        isLoading={isLoadingDiscounts}
        formData={discountFormData}
        setFormData={setDiscountFormData}
        onSubmit={handleCreateDiscount}
        isCreating={isCreatingDiscount}
      />

      {/* Event Header Image */}
      <div className="relative h-64 md:h-80 lg:h-96">
        <img 
          src={getImageUrl()} 
          alt={event.title} 
          className="w-full h-full object-cover" 
          onError={() => setImageError(true)}
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent">
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="container mx-auto max-w-6xl">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {isPastEvent && <span className="px-3 py-1.5 bg-gray-500 text-white text-xs font-bold rounded-full">Past Event</span>}
                    {event.isVirtual && <span className="px-3 py-1.5 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Virtual</span>}
                    {event.isFree && <span className="px-3 py-1.5 bg-purple-500 text-white text-xs font-bold rounded-full">FREE</span>}
                    {!event.isFree && event.price > 0 && <span className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-full">PAID EVENT</span>}
                  </div>
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3">{event.title}</h1>
                  <div className="flex flex-wrap items-center gap-4 text-white/90">
                    <span className="flex items-center gap-2"><Calendar className="h-5 w-5" />{formatDateTime(event.startDate)}</span>
                    {!event.isVirtual && (event.venue || event.location?.address) && (
                      <span className="flex items-center gap-2"><MapPin className="h-5 w-5" />{event.venue}</span>
                    )}
                  </div>
                </div>
                {!isPastEvent && !event.isFree && event.price > 0 && (
                  <div className="text-right">
                    <div className="text-3xl md:text-4xl font-bold text-white mb-1">{event.currency} {event.price.toLocaleString()}</div>
                    <p className="text-white/80 text-sm">Starting price</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold mb-4">About This Event</h2>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line text-base leading-relaxed">
                {event.description || 'No description provided.'}
              </p>
            </div>

            {/* Event Info */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold mb-6">Event Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Calendar className="h-5 w-5 text-gray-400" />Date & Time</h3>
                  <div><p className="text-sm text-gray-600 mb-1">Start</p><p className="font-medium">{formatDateTime(event.startDate)}</p></div>
                  <div className="mt-3"><p className="text-sm text-gray-600 mb-1">End</p><p className="font-medium">{formatDateTime(event.endDate)}</p></div>
                </div>
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    {event.isVirtual ? <Globe className="h-5 w-5 text-gray-400" /> : <MapPin className="h-5 w-5 text-gray-400" />}
                    {event.isVirtual ? 'Virtual Event' : 'Location'}
                  </h3>
                  {!event.isVirtual ? (
                    <p className="font-medium">{event.venue || event.location?.address || 'Location TBD'}</p>
                  ) : (
                    <div className="mt-4 p-4 bg-blue-50 rounded-xl">
                      <div className="flex items-center gap-2 mb-2"><Globe className="h-5 w-5 text-blue-500" /><span className="font-semibold">Virtual Event</span></div>
                      <p className="text-sm text-gray-600">Joining details will be provided after ticket purchase</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-6 border-t border-gray-200">
                <div><h3 className="font-semibold mb-3 flex items-center gap-2"><Tag className="h-5 w-5 text-gray-400" />Category</h3><span className="inline-block px-3 py-1.5 bg-gray-100 rounded-full text-sm">{event.category.charAt(0).toUpperCase() + event.category.slice(1)}</span></div>
                <div><h3 className="font-semibold mb-3">Organizer</h3><div className="flex items-center gap-3"><div className="w-12 h-12 bg-primary/10 rounded-full overflow-hidden"><img src={organizerAvatar} alt={organizer.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = '/cackpas.jpg' }} /></div><p className="font-medium truncate">{organizer.name}</p></div></div>
              </div>
            </div>
            
            {/* Ticket Types */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-bold mb-6">Available Tickets</h2>
              {ticketTypes.length > 0 ? (
                <div className="space-y-4">
                  {ticketTypes.map((ticketType) => {
                    const available = getAvailableTickets(ticketType)
                    const isAvailable = isTicketAvailable(ticketType)
                    return (
                      <div 
                        key={ticketType._id} 
                        onClick={() => isAvailable && handleTicketTypeSelect(ticketType)} 
                        className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                          selectedTicketType?._id === ticketType._id 
                            ? 'border-primary bg-primary/5' 
                            : 'border-gray-200 hover:border-gray-300'
                        } ${!isAvailable ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center justify-between mb-3">
                              <div>
                                <h3 className="font-semibold text-lg mb-1">{ticketType.name}</h3>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-600">{ticketType.category}</span>
                                  <span className="text-sm">•</span>
                                  {isOrganizer ? (
                                    // ✅ Organizer: exact numeric count
                                    <span className="text-sm">
                                      {available} of {ticketType.maxSupply > 0 ? ticketType.maxSupply : (event.capacity || 'Unlimited')} left
                                    </span>
                                  ) : (
                                    // ✅ Public: only "Available" or "Sold Out"
                                    <span
                                      className={`text-sm font-medium ${
                                        getPublicAvailabilityLabel(available) === 'Sold Out'
                                          ? 'text-red-600 dark:text-red-400'
                                          : 'text-green-600 dark:text-green-400'
                                      }`}
                                    >
                                      {getPublicAvailabilityLabel(available)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl font-bold text-primary">
                                  {event.isFree ? 'FREE' : `₦${ticketType.price.toLocaleString()}`}
                                </div>
                                {!event.isFree && <div className="text-sm text-gray-600">per ticket</div>}
                              </div>
                            </div>
                            {ticketType.description && <p className="text-gray-600 text-sm mb-3">{ticketType.description}</p>}
                          </div>
                          {selectedTicketType?._id === ticketType._id && <CheckCircle className="h-6 w-6 text-primary flex-shrink-0" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Ticket className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Tickets Available</h3>
                  <p className="text-gray-600 max-w-md mx-auto">Ticket sales haven't started yet or this event doesn't have any tickets configured.</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Right Column - Purchase Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-28">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-xl font-bold mb-6">Get Your Ticket</h2>
                {isPastEvent ? (
                  <div className="text-center py-8">
                    <Clock className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                    <h3 className="font-semibold mb-2">Event Has Ended</h3>
                    <Link href="/events" className="btn-primary px-6 py-3 inline-flex items-center gap-2 w-full justify-center">
                      <Ticket className="h-4 w-4" />Browse Upcoming Events
                    </Link>
                  </div>
                ) : (
                  <>
                    {selectedTicketType && (
                      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="font-semibold mb-1">{selectedTicketType.name}</h3>
                            <p className="text-sm text-gray-600">{selectedTicketType.category}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-primary">
                              {event.isFree ? 'FREE' : `₦${selectedTicketType.price.toLocaleString()}`}
                            </div>
                            <div className="text-sm text-gray-600">per ticket</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600 mb-2">Quantity</p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => handleQuantityChange(-1)} 
                                disabled={selectedQuantity <= 1} 
                                className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100 disabled:opacity-50"
                              >
                                <span className="text-lg">-</span>
                              </button>
                              <span className="text-xl font-semibold w-12 text-center">{selectedQuantity}</span>
                              <button 
                                onClick={() => handleQuantityChange(1)} 
                                className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                              >
                                <span className="text-lg">+</span>
                              </button>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600 mb-1">Total</p>
                            <div className="text-3xl font-bold text-primary">
                              {event.isFree ? 'FREE' : `₦${Number(getTotalPrice()).toLocaleString()}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* FREE EVENT BUTTON */}
                    {event.isFree && (
                      <button 
                        onClick={handleGetFreeTicket} 
                        disabled={isGettingFreeTicket} 
                        className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-3 text-lg bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
                      >
                        {isGettingFreeTicket ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
                        {isGettingFreeTicket ? 'Processing...' : 'Get Free Ticket'}
                      </button>
                    )}
                    
                    {/* PAID EVENT - Discount Code Input */}
                    {!event.isFree && selectedTicketType && selectedTicketType.price > 0 && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Discount Code</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={discountCode}
                              onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                              placeholder="Enter code"
                              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <button
                            onClick={applyDiscount}
                            disabled={isVerifyingDiscount || !discountCode}
                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                          >
                            {isVerifyingDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                          </button>
                        </div>
                        {appliedDiscount && (
                          <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                            {appliedDiscount.percent}% discount applied (₦{appliedDiscount.amount.toLocaleString()} off)
                          </p>
                        )}
                      </div>
                    )}
                    
                    {/* PAID EVENT - Payment Buttons - NO LOGIN REQUIRED */}
                    {!event.isFree && selectedTicketType && selectedTicketType.price > 0 && (
                      <div className="space-y-4">
                        <div className="flex gap-3 mb-4">
                          <button 
                            onClick={() => setSelectedPaymentMethod('flutterwave')} 
                            className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                              selectedPaymentMethod === 'flutterwave' 
                                ? 'bg-primary text-white' 
                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            <CreditCard className="h-4 w-4" />Card Payment
                          </button>
                          <button 
                            onClick={() => setSelectedPaymentMethod('crypto')} 
                            className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                              selectedPaymentMethod === 'crypto' 
                                ? 'bg-primary text-white' 
                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            <Wallet className="h-4 w-4" />Crypto
                          </button>
                        </div>
                        
                        {selectedPaymentMethod === 'flutterwave' && (
                          <button 
                            onClick={() => handlePayWithCard()} 
                            disabled={isProcessingPayment} 
                            className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                          >
                            {isProcessingPayment ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
                            {isProcessingPayment ? 'Processing...' : `Pay ₦${Number(getTotalPrice()).toLocaleString()}`}
                          </button>
                        )}
                        
                        {selectedPaymentMethod === 'crypto' && (
                          <button 
                            onClick={handlePayWithCrypto} 
                            className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
                          >
                            <Wallet className="h-5 w-5" />Pay with Crypto (Soon)
                          </button>
                        )}
                      </div>
                    )}
                    
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <Shield className="h-5 w-5 text-green-500 flex-shrink-0" />
                        <div><p className="font-medium text-sm">Secure Payment</p><p className="text-xs text-gray-600">PCI-DSS compliant</p></div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <QrCode className="h-5 w-5 text-blue-500 flex-shrink-0" />
                        <div><p className="font-medium text-sm">Digital Ticket</p><p className="text-xs text-gray-600">QR code for entry</p></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}