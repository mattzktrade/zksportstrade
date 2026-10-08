"use server"

import { hasCmsPermission } from "@/lib/auth/permissions"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { extractShortCodeFromText, extractTicketTokenFromText, verifyTicketQrPayload, ticketSigningSecret } from "@/lib/tickets/crypto"
import { guestHeadshotDataUrl } from "@/lib/tickets/public"
import { parseArrivedDates, parseValidDays, validDayLabels } from "@/lib/tickets/model"
import {
  admitTicketRow,
  loadTicketById,
  loadTicketByPublicToken,
  loadTicketByShortCode,
  loadBookingGuests,
  missingTicketingSchema,
  recordScanAttempt,
  undoArrival,
} from "@/lib/tickets/store"
import type { ScanCode, ScanMethod } from "@/lib/tickets/types"

type Result<T extends object = object> = ({ ok: true; message: string } & T) | { ok: false; message: string }

export type CheckInEventOption = {
  raceId: string
  eventDate: string | null
  label: string
  total: number
}

export type CheckInGuest = {
  ticketId: string
  guestName: string
  shortCode: string
  status: string
  daysLabel: string
  validDays: string[]
  eventDate: string | null
  tableNumber: string | null
  dietary: string | null
  headshotUrl: string | null
  arrivedAt: string | null
  arrivedDates: string[]
}

export type CheckInScanResult = {
  code: ScanCode
  message: string
  guestName: string
  shortCode: string
  daysLabel: string
  tableNumber: string | null
  dietary: string | null
  headshotUrl: string | null
  arrivedAt: string | null
  ticketId: string | null
}

async function viewGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.view")) return null
  const admin = createAdminClient()
  if (!admin) return null
  return { profile, admin }
}

async function manageGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  const admin = createAdminClient()
  if (!admin) return null
  return { profile, admin }
}

function todayIso(value?: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return new Date().toISOString().slice(0, 10)
}

export async function loadCheckInEvents(): Promise<Result<{ events: CheckInEventOption[] }>> {
  const session = await viewGate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  try {
    const { data, error } = await session.admin
      .from("tickets")
      .select("id, race_id, event_date, status, packages(name, races(name, season))")
      .neq("status", "void")
    if (error) throw new Error(error.message)
    const grouped = new Map<string, CheckInEventOption>()
    for (const row of data ?? []) {
      const raceId = String(row.race_id ?? "")
      const eventDate = row.event_date ? String(row.event_date).slice(0, 10) : ""
      const key = `${raceId}|${eventDate}`
      const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages
      const race = pkg && typeof pkg === "object" ? (Array.isArray((pkg as { races?: unknown }).races) ? (pkg as { races: Array<{ name?: string; season?: number }> }).races[0] : (pkg as { races?: { name?: string; season?: number } }).races) : null
      const label = [race?.name, race?.season, pkg && typeof pkg === "object" ? (pkg as { name?: string }).name : ""]
        .filter(Boolean)
        .join(" — ") || "Event"
      const current = grouped.get(key) ?? {
        raceId: raceId || key,
        eventDate: eventDate || null,
        label,
        total: 0,
      }
      current.total += 1
      grouped.set(key, current)
    }
    return { ok: true, message: "Loaded.", events: [...grouped.values()].sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? "")) }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load events."
    if (missingTicketingSchema(message)) {
      return { ok: false, message: "Apply the internal ticketing migration to open check-in." }
    }
    return { ok: false, message }
  }
}

export async function loadCheckInGuests(input: {
  raceId: string
  eventDate?: string | null
}): Promise<Result<{ guests: CheckInGuest[] }>> {
  const session = await viewGate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const admin = session.admin
  let query = admin.from("tickets").select("*").neq("status", "void")
  if (input.raceId && input.raceId.includes("|") === false && input.raceId.length > 8) {
    query = query.eq("race_id", input.raceId)
  }
  if (input.eventDate) query = query.eq("event_date", input.eventDate)
  const { data, error } = await query.order("short_code")
  if (error) return { ok: false, message: error.message }
  const guests: CheckInGuest[] = []
  const bookingGuests = new Map<string, Awaited<ReturnType<typeof loadBookingGuests>>>()
  async function guestsFor(dealId: string | null, orderId: string | null) {
    if (!dealId && !orderId) return []
    const key = `${orderId ?? ""}:${dealId ?? ""}`
    const cached = bookingGuests.get(key)
    if (cached) return cached
    const people = await loadBookingGuests(admin, { dealId, orderId })
    bookingGuests.set(key, people)
    return people
  }
  for (const row of data ?? []) {
    const ticket = {
      id: String(row.id),
      dealId: row.deal_id ? String(row.deal_id) : null,
      orderId: row.order_id ? String(row.order_id) : null,
      orderGuestId: row.order_guest_id ? String(row.order_guest_id) : null,
      dealGuestId: row.deal_guest_id ? String(row.deal_guest_id) : null,
      validDays: parseValidDays(row.valid_days),
      eventDate: row.event_date ? String(row.event_date).slice(0, 10) : null,
      shortCode: String(row.short_code),
      status: String(row.status),
      arrivedAt: row.arrived_at ? String(row.arrived_at) : null,
      arrivedDates: parseArrivedDates(row.arrived_dates, row.arrived_at ? String(row.arrived_at) : null),
      holderName: typeof row.holder_name === "string" ? row.holder_name.trim() : "",
      walkUp: row.walk_up === true,
    }
    const people = await guestsFor(ticket.dealId, ticket.orderId)
    const guest = people.find((person) => person.id === ticket.orderGuestId || person.id === ticket.dealGuestId)
    guests.push({
      ticketId: ticket.id,
      guestName: guest?.fullName || ticket.holderName || (ticket.walkUp ? "Walk-up guest" : "Unassigned"),
      shortCode: ticket.shortCode,
      status: ticket.status,
      daysLabel: validDayLabels(ticket.validDays),
      validDays: ticket.validDays,
      eventDate: ticket.eventDate,
      tableNumber: guest?.tableNumber ?? null,
      dietary: guest?.dietaryRequirements ?? null,
      headshotUrl: await guestHeadshotDataUrl(guest?.headshotPath),
      arrivedAt: ticket.arrivedAt,
      arrivedDates: ticket.arrivedDates,
    })
  }
  return { ok: true, message: "Loaded.", guests }
}

export async function scanCheckInTicket(input: {
  raw: string
  raceId?: string | null
  todayIso?: string | null
  method?: ScanMethod
  offlineQueuedAt?: string | null
}): Promise<Result<{ result: CheckInScanResult }>> {
  const session = await manageGate()
  if (!session) return { ok: false, message: "Operations permission is required to scan." }
  const raw = input.raw.trim()
  const method: ScanMethod = input.method ?? "qr"
  let ticket = null
  const verified = verifyTicketQrPayload(raw, ticketSigningSecret())
  if (verified.ok) {
    ticket = await loadTicketById(session.admin, verified.ticketId)
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    ticket = await loadTicketById(session.admin, raw.toLowerCase())
  } else {
    const token = extractTicketTokenFromText(raw)
    if (token) ticket = await loadTicketByPublicToken(session.admin, token)
    const short = extractShortCodeFromText(raw) ?? (/^ZK-[0-9A-Z]{6}$/i.test(raw) ? raw.toUpperCase() : null)
    if (!ticket && short) ticket = await loadTicketByShortCode(session.admin, short)
  }
  if (!ticket) {
    await recordScanAttempt(session.admin, {
      code: "invalid",
      method,
      actorId: session.profile.id,
      raceId: input.raceId,
      payloadPrefix: raw.slice(0, 24),
      offlineQueuedAt: input.offlineQueuedAt,
    })
    return {
      ok: true,
      message: "Not a ZK ticket.",
      result: {
        code: "invalid",
        message: "This QR is not a ZK ticket.",
        guestName: "",
        shortCode: "",
        daysLabel: "",
        tableNumber: null,
        dietary: null,
        headshotUrl: null,
        arrivedAt: null,
        ticketId: null,
      },
    }
  }
  const admitted = await admitTicketRow(session.admin, {
    ticket,
    actorId: session.profile.id,
    method,
    todayIso: todayIso(input.todayIso),
    selectedRaceId: input.raceId,
  })
  const people = await loadBookingGuests(session.admin, ticket)
  const guest = ticket.guest
    ? people.find((person) => person.source === ticket.guest?.source && person.id === ticket.guest.id)
    : null
  return {
    ok: true,
    message: admitted.message,
    result: {
      code: admitted.code,
      message: admitted.message,
      guestName: guest?.fullName || ticket.holderName || (ticket.walkUp ? "Walk-up guest" : "Guest"),
      shortCode: ticket.shortCode,
      daysLabel: validDayLabels(ticket.validDays),
      tableNumber: guest?.tableNumber ?? null,
      dietary: guest?.dietaryRequirements ?? null,
      headshotUrl: await guestHeadshotDataUrl(guest?.headshotPath),
      arrivedAt: admitted.arrivedAt ?? ticket.arrivedAt,
      ticketId: ticket.id,
    },
  }
}

export async function manualCheckInTicket(input: {
  ticketId: string
  raceId?: string | null
  todayIso?: string | null
}): Promise<Result<{ result: CheckInScanResult }>> {
  return scanCheckInTicket({ raw: input.ticketId, raceId: input.raceId, todayIso: input.todayIso, method: "manual" })
}

export async function undoCheckIn(input: { ticketId: string; reason: string; doorDate?: string | null }): Promise<Result> {
  const session = await manageGate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  return undoArrival(session.admin, {
    ticketId: input.ticketId,
    actorId: session.profile.id,
    reason: input.reason,
    doorDate: input.doorDate,
  })
}
