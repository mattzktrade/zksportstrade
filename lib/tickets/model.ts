import { costDaySlotsForDuration, isCostDaySlot, type CostDaySlot } from "@/lib/inventory/day-cost-allocation"
import { dateIsoForDaySlot } from "@/lib/admin/package-guest-list-model"
import type { GuestTicketStatus } from "@/lib/admin/package-guest-list-model"
import {
  ADMITTABLE_STATUSES,
  OPEN_TICKET_STATUSES,
  PHYSICAL_LOCATIONS,
  TICKET_KINDS,
  TICKET_STATUSES,
  TICKETING_MODES,
  type PhysicalLocation,
  type TicketKind,
  type TicketRecord,
  type TicketStatus,
  type TicketingMode,
} from "@/lib/tickets/types"

const MODE_SET = new Set<string>(TICKETING_MODES)
const KIND_SET = new Set<string>(TICKET_KINDS)
const STATUS_SET = new Set<string>(TICKET_STATUSES)
const LOCATION_SET = new Set<string>(PHYSICAL_LOCATIONS)

export function parseTicketingMode(value: string | null | undefined): TicketingMode | null {
  return value && MODE_SET.has(value) ? (value as TicketingMode) : null
}

export function parseTicketKind(value: string | null | undefined): TicketKind | null {
  return value && KIND_SET.has(value) ? (value as TicketKind) : null
}

export function parseTicketStatus(value: string | null | undefined): TicketStatus | null {
  return value && STATUS_SET.has(value) ? (value as TicketStatus) : null
}

export function parsePhysicalLocation(value: string | null | undefined): PhysicalLocation | null {
  return value && LOCATION_SET.has(value) ? (value as PhysicalLocation) : null
}

export function resolvedTicketingMode(
  bookingMode: string | null | undefined,
  packageMode: string | null | undefined,
): TicketingMode {
  return parseTicketingMode(bookingMode) ?? parseTicketingMode(packageMode) ?? "supplier_direct"
}

export function ticketingModeLabel(mode: TicketingMode): string {
  switch (mode) {
    case "zk_digital":
      return "ZK digital pass (we scan)"
    case "physical":
      return "Physical tickets"
    case "external_digital":
      return "Supplier digital (we forward)"
    case "supplier_direct":
      return "Supplier handles tickets"
    case "hybrid":
      return "Official ticket + ZK door pass"
  }
}

export function ticketKindForMode(mode: TicketingMode): TicketKind | null {
  switch (mode) {
    case "zk_digital":
    case "hybrid":
      return "zk_digital"
    case "physical":
      return "physical"
    case "external_digital":
      return "external_digital"
    case "supplier_direct":
      return null
  }
}

export function ticketHasScanQr(kind: TicketKind, mode: TicketingMode): boolean {
  return kind === "zk_digital" || mode === "hybrid"
}

export function isOpenTicketStatus(status: TicketStatus): boolean {
  return (OPEN_TICKET_STATUSES as readonly string[]).includes(status)
}

export function isAdmittableStatus(status: TicketStatus): boolean {
  return (ADMITTABLE_STATUSES as readonly string[]).includes(status)
}

export function guestTicketStatusFromTicket(status: TicketStatus): GuestTicketStatus {
  if (status === "void" || status === "draft") return "pending"
  if (status === "issued") return "issued"
  return "posted"
}

export function parseValidDays(value: unknown): CostDaySlot[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CostDaySlot => isCostDaySlot(String(item)))
}

export function validDaysForGuest(input: {
  attendanceDay?: string | null
  packageDuration?: string | null
  eventDate?: string | null
}): CostDaySlot[] {
  if (isCostDaySlot(input.attendanceDay)) return [input.attendanceDay]
  return costDaySlotsForDuration(input.packageDuration, input.eventDate)
}

const DAY_CHIP_LABELS: Record<CostDaySlot, string> = {
  thursday_only: "Thursday",
  friday_only: "Friday",
  saturday_only: "Saturday",
  sunday_only: "Sunday",
}

export function validDayChipLabels(days: readonly CostDaySlot[]): string[] {
  if (!days.length) return ["Event days"]
  return days.map((day) => DAY_CHIP_LABELS[day] ?? day)
}

export function validDayLabels(days: readonly CostDaySlot[]): string {
  return validDayChipLabels(days).join(", ")
}

export function daySlotForDate(eventDate: string | null | undefined, dateIso: string): CostDaySlot | null {
  const days: CostDaySlot[] = ["thursday_only", "friday_only", "saturday_only", "sunday_only"]
  for (const day of days) {
    if (dateIsoForDaySlot(eventDate, day) === dateIso) return day
  }
  return isCostDaySlot(dateIso) ? dateIso : null
}

export function parseArrivedDates(value: unknown, arrivedAt?: string | null): string[] {
  const fromArray = Array.isArray(value)
    ? value.map((item) => String(item).slice(0, 10)).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
    : []
  const legacy = arrivedAt?.slice(0, 10) ?? ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(legacy) && !fromArray.includes(legacy)) fromArray.push(legacy)
  return [...new Set(fromArray)].sort()
}

export function ticketArrivedOnIsoDate(
  ticket: Pick<TicketRecord, "arrivedDates" | "arrivedAt">,
  dateIso: string,
): boolean {
  return parseArrivedDates(ticket.arrivedDates, ticket.arrivedAt).includes(dateIso)
}

export type DoorDayOption = {
  slot: CostDaySlot
  iso: string
  label: string
}

export function doorDayOptions(
  eventDate: string | null | undefined,
  tickets: readonly { validDays: readonly CostDaySlot[] }[],
): DoorDayOption[] {
  const labels: Record<CostDaySlot, string> = {
    thursday_only: "Thursday",
    friday_only: "Friday",
    saturday_only: "Saturday",
    sunday_only: "Sunday",
  }
  const slots = new Set<CostDaySlot>()
  for (const ticket of tickets) {
    for (const day of ticket.validDays) slots.add(day)
  }
  const ordered: CostDaySlot[] = ["thursday_only", "friday_only", "saturday_only", "sunday_only"]
  const fromTickets = ordered.filter((slot) => slots.has(slot))
  const use = fromTickets.length ? fromTickets : ordered.filter((slot) => dateIsoForDaySlot(eventDate, slot))
  return use
    .map((slot) => {
      const iso = dateIsoForDaySlot(eventDate, slot)
      return iso ? { slot, iso, label: labels[slot] } : null
    })
    .filter((row): row is DoorDayOption => Boolean(row))
}

export function ticketValidOnIsoDate(ticket: Pick<TicketRecord, "eventDate" | "validDays">, dateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false
  if (ticket.validDays.length === 0) {
    const event = ticket.eventDate?.slice(0, 10) ?? ""
    if (!event) return true
    return dateIso <= event && dateIso >= addUtcDays(event, -3)
  }
  return ticket.validDays.some((day) => dateIsoForDaySlot(ticket.eventDate, day) === dateIso)
}

export function earliestValidDate(ticket: Pick<TicketRecord, "eventDate" | "validDays">): string | null {
  const event = ticket.eventDate?.slice(0, 10) ?? ""
  if (ticket.validDays.length === 0) {
    return event ? addUtcDays(event, -3) : null
  }
  const dates = ticket.validDays
    .map((day) => dateIsoForDaySlot(ticket.eventDate, day))
    .filter((value): value is string => Boolean(value))
    .sort()
  return dates[0] ?? event ?? null
}

export function statusAfterUndoArrival(ticket: Pick<TicketRecord, "deliveredAt" | "sentAt">): TicketStatus {
  if (ticket.deliveredAt) return "delivered"
  if (ticket.sentAt) return "sent"
  return "issued"
}

export function physicalLocationAfterPost(): PhysicalLocation {
  return "in_transit"
}

function addUtcDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
