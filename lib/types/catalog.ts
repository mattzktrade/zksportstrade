import type { InvoiceWorkflowStatus } from "@/lib/invoices/status"

export interface Package {
  id: string
  name: string
  circuit: string
  location: string
  country: string
  countryCode: string
  date: string
  dateRange: string
  price: number | null
  currency: string
  availability: number | string
  totalCapacity: number
  image: string
  tier: "paddock" | "champions" | "legend" | "hero"
  /** e.g. 3_day, friday_only — human label via packageDurationLabel */
  duration?: string | null
  includes: string[]
  /** Marketing body shown on package detail; falls back to default copy when empty */
  description?: string | null
  /** Extra gallery image URLs (primary `image` is always first slide) */
  galleryImages?: string[]
  featured?: boolean
  /** HTTPS URL to brochure PDF or page for agents to share (from Supabase when set) */
  brochureUrl?: string | null
  /** Set when loaded from Supabase (used for navigation) */
  raceId?: string
  /** Active inventory held for you (unexpired); already included in numeric `availability` when loaded signed-in. */
  agentHoldUnits?: number
  /** Earliest expiry among your active holds on this package (ISO). */
  agentHoldExpiresAt?: string | null
}

export interface Race {
  id: string
  name: string
  shortName: string
  location: string
  country: string
  countryCode: string
  date: string
  dateRange: string
  image: string
  packagesAvailable: number
  lowestPrice: number
}

export interface Booking {
  id: string
  /** Human-readable order reference from the database (e.g. ZK-2026-…) */
  orderReference?: string
  packageId: string
  packageName: string
  circuit: string
  date: string
  guests: number
  /** Invoice workflow status (admin-controlled); mirrors Invoices page */
  invoiceStatus: InvoiceWorkflowStatus
  totalAmount: number
  currency: string
  createdAt: string
  clientName: string
  clientEmail: string
  /** When loaded from Supabase */
  packageTier?: string
  packageDuration?: string | null
}

export interface Invoice {
  id: string
  bookingId: string
  /** Internal order id for deep links from bookings */
  orderId?: string
  amount: number
  currency: string
  status: InvoiceWorkflowStatus
  /** Set when admin moves to awaiting_payment; null while awaiting_invoice */
  issuedAt: string | null
  packageName: string
}
