import type { CostDaySlot } from "@/lib/inventory/day-cost-allocation"

export const TICKETING_MODES = [
  "zk_digital",
  "physical",
  "external_digital",
  "supplier_direct",
  "hybrid",
] as const

export type TicketingMode = (typeof TICKETING_MODES)[number]

export const TICKET_KINDS = ["zk_digital", "physical", "external_digital"] as const
export type TicketKind = (typeof TICKET_KINDS)[number]

export const TICKET_STATUSES = ["draft", "issued", "sent", "delivered", "arrived", "void"] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const PHYSICAL_LOCATIONS = [
  "in_office",
  "packed",
  "in_transit",
  "awaiting_collection",
  "with_guest",
] as const
export type PhysicalLocation = (typeof PHYSICAL_LOCATIONS)[number]

export const SCAN_METHODS = ["qr", "short_code", "manual", "offline"] as const
export type ScanMethod = (typeof SCAN_METHODS)[number]

export const ADMITTABLE_STATUSES: readonly TicketStatus[] = ["issued", "sent", "delivered"]

export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  "draft",
  "issued",
  "sent",
  "delivered",
  "arrived",
]

export type TicketGuestRef = {
  source: "order" | "deal"
  id: string
}

export type TicketRecord = {
  id: string
  status: TicketStatus
  kind: TicketKind
  guest: TicketGuestRef | null
  validDays: CostDaySlot[]
  physicalSerial: string | null
  physicalLocation: PhysicalLocation | null
  shortCode: string
  tokenHash: string
  signingKid: string
  raceId: string | null
  packageId: string | null
  eventDate: string | null
  dealId: string | null
  orderId: string | null
  issuedAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  arrivedAt: string | null
  arrivedBy: string | null
  voidedAt: string | null
  voidedReason: string | null
  trackingNumber: string | null
  bookingCancelled: boolean
}

export type ScanCode =
  | "ok"
  | "already_arrived"
  | "void"
  | "cancelled"
  | "wrong_day"
  | "wrong_event"
  | "too_early"
  | "not_admittable"
  | "invalid"
  | "unknown"

export type ScanDecision = {
  code: ScanCode
  message: string
  ticket?: TicketRecord
}

export type IssueCheckInput = {
  paid: boolean
  bookingCancelled: boolean
  mode: TicketingMode
  guestNamed: boolean
  guestAlreadyHasOpenTicket: boolean
  openTicketCount: number
  quantity: number
}

export type AdmitApplyResult =
  | { ok: true; ticket: TicketRecord }
  | { ok: false; code: Extract<ScanCode, "already_arrived" | "void" | "cancelled" | "not_admittable"> }
