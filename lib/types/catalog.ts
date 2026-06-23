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
  /** When true, hidden from the agent portal until an admin shows it again. */
  isHidden?: boolean
  /** Paddock Club etc.: checkout submits a request for admin approval instead of instant booking. */
  requiresBookingApproval?: boolean
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
  /** Calendar year from catalog (e.g. 2026, 2027). */
  season?: number
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
  /** Xero invoice number once synced (e.g. INV-0001) */
  xeroInvoiceNumber?: string | null
  totalAmount: number
  currency: string
  createdAt: string
  clientName: string
  clientEmail: string
  /** When loaded from Supabase */
  packageTier?: string
  packageDuration?: string | null
  /** Set when this row is a pending/rejected approval request, not a confirmed order. */
  approvalRequestStatus?: "pending" | "approved" | "rejected"
  approvalRequestReference?: string
}

export interface Invoice {
  id: string
  bookingId: string
  /** Internal order id for deep links from bookings */
  orderId?: string
  /** Xero invoice number once synced */
  xeroInvoiceNumber?: string | null
  amount: number
  currency: string
  status: InvoiceWorkflowStatus
  /** Set when admin moves to awaiting_payment; null while awaiting_invoice */
  issuedAt: string | null
  packageName: string
}
