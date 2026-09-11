import {
  costDaySlotsForDuration,
  isCostDaySlot,
  type CostDaySlot,
} from "@/lib/inventory/day-cost-allocation"
import { shellDayLabel, type ShellDayDuration } from "@/lib/catalog/shell-single-tickets"

export const GUEST_TICKET_STATUSES = ["pending", "issued", "posted"] as const
export type GuestTicketStatus = (typeof GUEST_TICKET_STATUSES)[number]

export type GuestListDayId = "all" | CostDaySlot

export type GuestListDayChip = {
  id: GuestListDayId
  label: string
}

export type GuestListGuestRecord = {
  id: string
  fullName: string | null
  tableNumber: string | null
  ticketNumber: string | null
  paddockTour: string | null
  ticketStatus: GuestTicketStatus
  sortOrder: number
  email?: string | null
  phone?: string | null
  nationality?: string | null
  dateOfBirth?: string | null
  dietaryRequirements?: string | null
  specialRequests?: string | null
  isLeadGuest?: boolean
  attendanceDay?: string | null
  headshotPath?: string | null
}

export type GuestListSupplierSlice = {
  name: string | null
  quantity: number
  deadline: string | null
}

export type GuestListExpandedSeat = {
  slotIndex: number
  guest: GuestListGuestRecord | null
  supplierName: string | null
  supplierDeadline: string | null
}

export type PackageGuestListSeat = {
  id: string
  guestId: string | null
  orderId: string | null
  dealId: string | null
  packageId: string
  daySlots: string[]
  slotIndex: number
  guestName: string | null
  email: string | null
  phone: string | null
  clientName: string
  clientAccountId: string | null
  orderNumber: string
  dealHref: string | null
  tableNumber: string
  ticketNumber: string
  paddockTour: string
  supplierName: string | null
  supplierDeadline: string | null
  supplierDetailsSentAt: string | null
  ticketStatus: GuestTicketStatus
  deliveryMethod: string
  collectionPoint: string
  collectionTime: string
  contactOnSite: string
  internalNotes: string
  notesUpdatedAt: string | null
  notesUpdatedBy: string | null
  bookingQuantity: number
  nationality: string | null
  dateOfBirth: string | null
  dietaryRequirements: string | null
  specialRequests: string | null
  isLeadGuest: boolean
  attendanceDay: string | null
  headshotPath: string | null
}

export type PackageGuestListData = {
  days: GuestListDayChip[]
  seats: PackageGuestListSeat[]
}

const DAY_ORDER: CostDaySlot[] = [
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
]

const RACE_DAY_SLOT: Record<number, CostDaySlot> = {
  0: "sunday_only",
  6: "saturday_only",
}

export function parseGuestTicketStatus(value: string | null | undefined): GuestTicketStatus {
  if (value === "issued" || value === "posted" || value === "pending") return value
  return "pending"
}

export function isGuestTicketIssued(status: GuestTicketStatus): boolean {
  return status === "issued" || status === "posted"
}

export function expandGuestSeats(
  quantity: number,
  guests: readonly GuestListGuestRecord[],
): GuestListExpandedSeat[] {
  const needed = Math.max(0, Math.floor(Number(quantity) || 0))
  const sorted = [...guests].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id.localeCompare(b.id)
  })
  const count = Math.max(needed, sorted.length)
  const seats: GuestListExpandedSeat[] = []
  for (let i = 0; i < count; i += 1) {
    seats.push({
      slotIndex: i,
      guest: sorted[i] ?? null,
      supplierName: null,
      supplierDeadline: null,
    })
  }
  return seats
}

export type GuestListDaySeat = GuestListExpandedSeat & { daySlots: CostDaySlot[] }

export function expandBookingGuestSeats(input: {
  quantity: number
  daySlots: readonly CostDaySlot[]
  guests: readonly GuestListGuestRecord[]
  mode: "same" | "per_day"
}): GuestListDaySeat[] {
  const qty = Math.max(0, Math.floor(Number(input.quantity) || 0))
  const days = input.daySlots.filter((slot) => DAY_ORDER.includes(slot))
  if (input.mode !== "per_day" || days.length <= 1) {
    const allDay = input.guests.filter((guest) => !guest.attendanceDay)
    return expandGuestSeats(qty, allDay.length ? allDay : input.guests).map((seat) => ({
      ...seat,
      daySlots: [...days],
    }))
  }
  const seats: GuestListDaySeat[] = []
  for (const day of days) {
    const dayGuests = input.guests.filter((guest) => guest.attendanceDay === day)
    for (const seat of expandGuestSeats(qty, dayGuests)) {
      seats.push({
        ...seat,
        daySlots: [day],
      })
    }
  }
  return seats
}

export function assignSuppliersToSeats(
  seats: GuestListExpandedSeat[],
  allocations: readonly GuestListSupplierSlice[],
): GuestListExpandedSeat[] {
  const queue: Array<{ name: string | null; deadline: string | null }> = []
  for (const slice of allocations) {
    const n = Math.max(0, Math.floor(Number(slice.quantity) || 0))
    for (let i = 0; i < n; i += 1) {
      queue.push({
        name: slice.name?.trim() || null,
        deadline: slice.deadline,
      })
    }
  }
  return seats.map((seat, index) => {
    const slice = queue[index] ?? { name: null, deadline: null }
    return {
      ...seat,
      supplierName: slice.name,
      supplierDeadline: slice.deadline,
    }
  })
}

export function assignSuppliersAcrossDays(
  seats: GuestListDaySeat[],
  allocations: readonly GuestListSupplierSlice[],
): GuestListDaySeat[] {
  const dayKeys = [
    ...new Set(
      seats
        .map((seat) => (seat.daySlots.length === 1 ? seat.daySlots[0] : null))
        .filter((day): day is CostDaySlot => Boolean(day)),
    ),
  ]
  if (dayKeys.length <= 1) {
    return assignSuppliersToSeats(seats, allocations).map((seat, index) => ({
      ...seat,
      daySlots: seats[index]?.daySlots ?? [],
    }))
  }
  return dayKeys.flatMap((day) => {
    const group = seats.filter((seat) => seat.daySlots[0] === day)
    return assignSuppliersToSeats(group, allocations).map((seat, index) => ({
      ...seat,
      daySlots: group[index]?.daySlots ?? [day],
    }))
  })
}

export function guestListDayRank(day: string | null | undefined): number {
  if (!day) return 9
  const index = DAY_ORDER.indexOf(day as CostDaySlot)
  return index >= 0 ? index : 8
}

const SEAT_DAY_SHORT: Record<CostDaySlot, string> = {
  thursday_only: "Thu",
  friday_only: "Fri",
  saturday_only: "Sat",
  sunday_only: "Sun",
}

export function guestListSeatDayShortLabel(daySlots: readonly string[]): string | null {
  if (daySlots.length !== 1) return null
  const slot = daySlots[0]
  if (!isCostDaySlot(slot)) return null
  return SEAT_DAY_SHORT[slot]
}

export function guestDetailsNeeded(guest: GuestListGuestRecord | null): boolean {
  return !guest?.fullName?.trim()
}

export function supplierDetailsState(
  sentAt: string | null | undefined,
  deadline: string | null | undefined,
  todayIso: string,
): "sent" | "overdue" | "not_sent" {
  if (sentAt) return "sent"
  const due = deadline?.slice(0, 10) ?? ""
  if (due && due < todayIso.slice(0, 10)) return "overdue"
  return "not_sent"
}

export function utcTodayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function eventDateWeekday(eventDateIso: string | null | undefined): number | null {
  const iso = eventDateIso?.trim().slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getUTCDay()
}

export function dateIsoForDaySlot(
  eventDateIso: string | null | undefined,
  slot: CostDaySlot,
): string | null {
  const iso = eventDateIso?.trim().slice(0, 10) ?? ""
  const weekday = eventDateWeekday(iso)
  if (!iso || weekday == null) return null
  const raceSlot = RACE_DAY_SLOT[weekday] ?? "sunday_only"
  const raceIdx = DAY_ORDER.indexOf(raceSlot)
  const slotIdx = DAY_ORDER.indexOf(slot)
  if (raceIdx < 0 || slotIdx < 0) return null
  const race = new Date(`${iso}T00:00:00Z`)
  race.setUTCDate(race.getUTCDate() + (slotIdx - raceIdx))
  return race.toISOString().slice(0, 10)
}

export function formatGuestListDayChipLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  const weekday = parsed.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })
  const day = parsed.getUTCDate()
  const month = parsed.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
  return `${weekday} ${day} ${month}`
}

export function formatGuestListDeadline(isoDate: string | null | undefined): string {
  const iso = isoDate?.slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—"
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return "—"
  const day = parsed.getUTCDate()
  const month = parsed.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })
  return `${day} ${month}`
}

export function guestListDayChips(
  eventDateIso: string | null | undefined,
  packageDurations: readonly (string | null | undefined)[],
): GuestListDayChip[] {
  const slots = new Set<CostDaySlot>()
  for (const duration of packageDurations) {
    for (const slot of costDaySlotsForDuration(duration, eventDateIso)) {
      slots.add(slot)
    }
  }
  const ordered = DAY_ORDER.filter((slot) => slots.has(slot))
  if (ordered.length === 0) {
    return [{ id: "all", label: "All days" }]
  }
  return [
    { id: "all", label: "All days" },
    ...ordered.map((slot) => {
      const iso = dateIsoForDaySlot(eventDateIso, slot)
      return {
        id: slot,
        label: iso ? formatGuestListDayChipLabel(iso) : shellDayLabel(slot as ShellDayDuration),
      }
    }),
  ]
}

export function seatAttendsDay(daySlots: readonly string[], day: GuestListDayId): boolean {
  if (day === "all") return true
  if (daySlots.length === 0) return true
  return daySlots.includes(day)
}

export function guestListStats(seats: readonly { ticketStatus: GuestTicketStatus; paddockTour: string | null; tableNumber: string | null }[]) {
  const tables = new Set<string>()
  let issued = 0
  let pending = 0
  let tours = 0
  for (const seat of seats) {
    if (isGuestTicketIssued(seat.ticketStatus)) issued += 1
    else pending += 1
    if (seat.paddockTour?.trim()) tours += 1
    const table = seat.tableNumber?.trim()
    if (table) tables.add(table.toLowerCase())
  }
  return {
    totalGuests: seats.length,
    ticketsIssued: issued,
    pendingIssue: pending,
    paddockTourSlots: tours,
    tablesInUse: tables.size,
  }
}
