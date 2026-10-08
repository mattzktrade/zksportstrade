import {
  ticketValidOnIsoDate,
  earliestValidDate,
  isAdmittableStatus,
  ticketArrivedOnIsoDate,
  ticketKindForMode,
} from "@/lib/tickets/model"
import type {
  AdmitApplyResult,
  IssueCheckInput,
  ScanDecision,
  TicketRecord,
  TicketingMode,
} from "@/lib/tickets/types"

export function canIssueTickets(input: IssueCheckInput): { ok: true } | { ok: false; message: string } {
  if (input.bookingCancelled) return { ok: false, message: "This booking is cancelled. Tickets cannot be issued." }
  if (!input.paid) return { ok: false, message: "The booking must be paid before tickets are issued." }
  if (!ticketKindForMode(input.mode)) {
    return { ok: false, message: "This product is set to supplier-handled tickets. Nothing for us to issue." }
  }
  if (!input.guestNamed) return { ok: false, message: "Name the guest before issuing their ticket." }
  if (input.guestAlreadyHasOpenTicket) {
    return { ok: false, message: "This guest already has a live ticket. Void it before issuing another." }
  }
  const quantity = Math.max(0, Math.floor(Number(input.quantity) || 0))
  if (input.openTicketCount >= quantity) {
    return { ok: false, message: "Cannot issue more tickets than places on the booking." }
  }
  return { ok: true }
}

export function canIssueWalkUpTicket(input: { mode: TicketingMode; liveWalkUpCount: number }): { ok: true } | { ok: false; message: string } {
  if (ticketKindForMode(input.mode) !== "zk_digital") {
    return { ok: false, message: "Walk-up ZK passes are only for products we scan at our door." }
  }
  if (input.liveWalkUpCount >= 40) {
    return { ok: false, message: "There are already 40 live walk-up tickets on this product. Void unused ones first." }
  }
  return { ok: true }
}

export function canReceivePhysicalPool(input: {
  bookingCancelled: boolean
  paid: boolean
  expected: number
  alreadyOpen: number
  receiving: number
}): { ok: true } | { ok: false; message: string } {
  if (input.bookingCancelled) return { ok: false, message: "This booking is cancelled." }
  if (!input.paid) return { ok: false, message: "The booking must be paid before tickets are received." }
  const expected = Math.max(0, Math.floor(Number(input.expected) || 0))
  const receiving = Math.max(0, Math.floor(Number(input.receiving) || 0))
  if (receiving <= 0) return { ok: false, message: "Enter how many physical tickets arrived." }
  if (input.alreadyOpen + receiving > expected) {
    return { ok: false, message: `Only ${expected} places are on this booking.` }
  }
  return { ok: true }
}

export function serialIsAvailable(
  serial: string,
  openSerials: readonly string[],
): { ok: true } | { ok: false; message: string } {
  const value = serial.trim()
  if (!value) return { ok: false, message: "Enter the ticket serial." }
  const needle = value.toLowerCase()
  if (openSerials.some((item) => item.trim().toLowerCase() === needle)) {
    return { ok: false, message: "That serial is already assigned. Never reuse a live serial." }
  }
  return { ok: true }
}

export function decideScan(input: {
  payloadOk: boolean
  ticket: TicketRecord | null
  selectedRaceId?: string | null
  todayIso: string
  nowMs?: number
}): ScanDecision {
  if (!input.payloadOk) {
    return { code: "invalid", message: "This QR is not a ZK ticket." }
  }
  const ticket = input.ticket
  if (!ticket) return { code: "unknown", message: "This ticket is not on file." }
  if (ticket.bookingCancelled) {
    return { code: "cancelled", message: "This booking is cancelled.", ticket }
  }
  if (ticket.status === "void" || ticket.voidedAt) {
    return { code: "void", message: "This ticket was voided. Ask the guest for the replacement.", ticket }
  }
  const selectedRace = input.selectedRaceId?.trim() ?? ""
  if (selectedRace && ticket.raceId && ticket.raceId !== selectedRace) {
    return { code: "wrong_event", message: "This ticket is for a different event.", ticket }
  }
  const earliest = earliestValidDate(ticket)
  if (earliest && input.todayIso < earliest) {
    return { code: "too_early", message: "This ticket is not valid yet.", ticket }
  }
  if (!ticketValidOnIsoDate(ticket, input.todayIso)) {
    return { code: "wrong_day", message: "This ticket is not valid today.", ticket }
  }
  if (ticket.status === "arrived" || ticket.arrivedAt) {
    if (ticketArrivedOnIsoDate(ticket, input.todayIso)) {
      return {
        code: "already_arrived",
        message: "Already arrived today. Do not let a second person in on this code.",
        ticket,
      }
    }
    return { code: "ok", message: "Admit this guest.", ticket }
  }
  if (!isAdmittableStatus(ticket.status)) {
    return { code: "not_admittable", message: "This ticket is not ready to scan.", ticket }
  }
  return { code: "ok", message: "Admit this guest.", ticket }
}

export function applyAdmit(
  ticket: TicketRecord,
  atIso: string,
  staffId: string,
  doorDate = atIso.slice(0, 10),
): AdmitApplyResult {
  if (ticket.bookingCancelled) return { ok: false, code: "cancelled" }
  if (ticket.status === "void" || ticket.voidedAt) return { ok: false, code: "void" }
  if (ticketArrivedOnIsoDate(ticket, doorDate)) return { ok: false, code: "already_arrived" }
  if (!isAdmittableStatus(ticket.status) && ticket.status !== "arrived") {
    return { ok: false, code: "not_admittable" }
  }
  const arrivedDates = [...new Set([...(ticket.arrivedDates ?? []), doorDate])].sort()
  return {
    ok: true,
    ticket: {
      ...ticket,
      status: "arrived",
      arrivedAt: atIso,
      arrivedBy: staffId,
      arrivedDates,
    },
  }
}

export function applyVoid(ticket: TicketRecord, atIso: string, reason: string): TicketRecord {
  return {
    ...ticket,
    status: "void",
    voidedAt: atIso,
    voidedReason: reason.trim() || "Reissued",
    arrivedAt: ticket.arrivedAt,
  }
}
