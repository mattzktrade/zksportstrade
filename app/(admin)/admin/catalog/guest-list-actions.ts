"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { parseGuestTicketStatus, type GuestTicketStatus } from "@/lib/admin/package-guest-list-model"
import { parseAttendanceDay } from "@/lib/guest-details/model"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { saveOrderGuests, deleteOrderGuest } from "@/app/(admin)/admin/operations/actions"
import { sendTicketClientEmail } from "@/lib/email/send-ticket-email"
import { isCostDaySlot, type CostDaySlot } from "@/lib/inventory/day-cost-allocation"
import { buildOperationsEmailDraft } from "@/lib/operations/emails"
import { validDayLabels } from "@/lib/tickets/model"
import { ticketLinkLine } from "@/lib/tickets/send"
import {
  issueWalkUpTicket,
  loadWalkUpTickets,
  markTicketsSentDelivered,
  missingTicketingSchema,
  voidAndReissueTicket,
} from "@/lib/tickets/store"
import { ticketPublicUrl } from "@/lib/tickets/url"

type Result<T extends object = object> = ({ ok: true; message: string } & T) | { ok: false; message: string }

type GuestNameDraft = {
  id?: string
  fullName: string
  email: string
  phone: string
  nationality: string
  dateOfBirth: string
  dietaryRequirements: string
  specialRequests: string
  isLeadGuest: boolean
  sortOrder?: number
  attendanceDay?: string | null
  headshotPath?: string | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected guest list error."
}

function migrationMessage(message: string): string | null {
  const value = message.toLowerCase()
  if (
    value.includes("ticket_status") ||
    value.includes("paddock_tour") ||
    value.includes("table_number") ||
    value.includes("ticket_number") ||
    value.includes("supplier_details_sent_at") ||
    value.includes("delivery_method") ||
    value.includes("collection_point") ||
    value.includes("attendance_day") ||
    value.includes("headshot_path")
  ) {
    return "Apply the latest database migration to store guest-list ticket, table, and delivery fields."
  }
  return null
}

async function guestListGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  const admin = createAdminClient()
  if (!admin) return null
  return { profile, admin }
}

function revalidateGuestList() {
  revalidatePath("/admin/catalog", "layout")
  revalidatePath("/admin/operations")
  revalidatePath("/admin/deals", "layout")
}

export async function savePackageGuestNames(input: {
  orderId?: string | null
  dealId?: string | null
  guests: GuestNameDraft[]
}): Promise<Result> {
  const result = await saveOrderGuests({
    orderId: input.orderId,
    dealId: input.dealId,
    guests: input.guests.map((guest, index) => ({
      guestId: guest.id,
      fullName: guest.fullName,
      email: guest.email,
      phone: guest.phone,
      nationality: guest.nationality,
      dateOfBirth: guest.dateOfBirth,
      dietaryRequirements: guest.dietaryRequirements,
      specialRequests: guest.specialRequests,
      isLeadGuest: guest.isLeadGuest,
      sortOrder: guest.sortOrder ?? index,
      attendanceDay: guest.attendanceDay,
      headshotPath: guest.headshotPath,
    })),
  })
  if (result.ok) revalidateGuestList()
  return result
}

export async function removePackageGuest(input: {
  orderId?: string | null
  dealId?: string | null
  guestId: string
}): Promise<Result> {
  const result = await deleteOrderGuest(input)
  if (result.ok) revalidateGuestList()
  return result
}

export async function saveGuestListSeat(input: {
  guestId?: string | null
  orderId?: string | null
  dealId?: string | null
  slotIndex: number
  attendanceDay?: string | null
  tableNumber?: string | null
  ticketNumber?: string | null
  paddockTour?: string | null
  ticketStatus?: GuestTicketStatus | string | null
}): Promise<Result> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  const orderId = blank(input.orderId)
  const dealId = blank(input.dealId)
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid order." }
  if (!orderId && (!dealId || !UUID_RE.test(dealId))) return { ok: false, message: "Invalid deal." }

  const payload: Record<string, unknown> = {
    table_number: blank(input.tableNumber),
    ticket_number: blank(input.ticketNumber),
    paddock_tour: blank(input.paddockTour),
    ticket_status: parseGuestTicketStatus(input.ticketStatus),
    sort_order: Math.max(0, Math.floor(Number(input.slotIndex) || 0)),
    updated_at: new Date().toISOString(),
  }
  if (input.attendanceDay !== undefined) {
    payload.attendance_day = parseAttendanceDay(input.attendanceDay)
  }

  const table = orderId ? "order_guests" : "deal_guests"
  const parent = orderId ? { order_id: orderId } : { deal_id: dealId! }

  try {
    if (input.guestId && UUID_RE.test(input.guestId)) {
      const query = gate.admin.from(table).update(payload).eq("id", input.guestId)
      const { error } = orderId ? await query.eq("order_id", orderId) : await query.eq("deal_id", dealId!)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await gate.admin.from(table).insert({
        ...parent,
        ...payload,
        full_name: null,
        is_lead_guest: false,
        details_complete: false,
      })
      if (error) throw new Error(error.message)
    }
    revalidateGuestList()
    return { ok: true, message: "Guest list updated." }
  } catch (error) {
    const message = errorMessage(error)
    return { ok: false, message: migrationMessage(message) ?? message }
  }
}

export async function saveGuestListBooking(input: {
  orderId?: string | null
  dealId?: string | null
  deliveryMethod?: string | null
  collectionPoint?: string | null
  collectionTime?: string | null
  contactOnSite?: string | null
  internalNotes?: string | null
  supplierDetailsSent?: boolean
}): Promise<Result> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  const orderId = blank(input.orderId)
  const dealId = blank(input.dealId)
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid order." }
  if (!orderId && (!dealId || !UUID_RE.test(dealId))) return { ok: false, message: "Invalid deal." }

  const now = new Date().toISOString()
  const patch: {
    updated_by: string
    updated_at: string
    delivery_method?: string | null
    collection_point?: string | null
    collection_time?: string | null
    contact_on_site?: string | null
    internal_notes?: string | null
  } = {
    updated_by: gate.profile.id,
    updated_at: now,
  }
  if (input.deliveryMethod !== undefined) patch.delivery_method = blank(input.deliveryMethod)
  if (input.collectionPoint !== undefined) patch.collection_point = blank(input.collectionPoint)
  if (input.collectionTime !== undefined) patch.collection_time = blank(input.collectionTime)
  if (input.contactOnSite !== undefined) patch.contact_on_site = blank(input.contactOnSite)
  if (input.internalNotes !== undefined) patch.internal_notes = blank(input.internalNotes)

  try {
    if (orderId) {
      const { data: existing } = await gate.admin
        .from("order_operations")
        .select("supplier_details_sent_at")
        .eq("order_id", orderId)
        .maybeSingle()
      const sentAt =
        input.supplierDetailsSent === undefined
          ? (existing as { supplier_details_sent_at?: string | null } | null)?.supplier_details_sent_at ?? null
          : input.supplierDetailsSent
            ? (existing as { supplier_details_sent_at?: string | null } | null)?.supplier_details_sent_at || now
            : null
      if (existing) {
        const { error } = await gate.admin
          .from("order_operations")
          .update({ ...patch, supplier_details_sent_at: sentAt })
          .eq("order_id", orderId)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await gate.admin.from("order_operations").insert({
          order_id: orderId,
          ...patch,
          supplier_details_sent_at: sentAt,
        })
        if (error) throw new Error(error.message)
      }
    }
    if (dealId) {
      const { data: existing } = await gate.admin
        .from("deal_operations")
        .select("supplier_details_sent_at, fulfilment_status, guest_details_status, communication_status, supplier_status, delivery_status")
        .eq("deal_id", dealId)
        .maybeSingle()
      const current = existing as {
        supplier_details_sent_at?: string | null
        fulfilment_status?: string
        guest_details_status?: string
        communication_status?: string
        supplier_status?: string
        delivery_status?: string
      } | null
      const sentAt =
        input.supplierDetailsSent === undefined
          ? current?.supplier_details_sent_at ?? null
          : input.supplierDetailsSent
            ? current?.supplier_details_sent_at || now
            : null
      const { error } = await gate.admin.from("deal_operations").upsert(
        {
          deal_id: dealId,
          fulfilment_status: current?.fulfilment_status ?? "confirmed",
          guest_details_status: current?.guest_details_status ?? "not_requested",
          communication_status: current?.communication_status ?? "not_started",
          supplier_status: current?.supplier_status ?? "unassigned",
          delivery_status: current?.delivery_status ?? "not_ready",
          ...patch,
          supplier_details_sent_at: sentAt,
        },
        { onConflict: "deal_id" },
      )
      if (error) throw new Error(error.message)
    }
    revalidateGuestList()
    return { ok: true, message: "Booking details saved." }
  } catch (error) {
    const message = errorMessage(error)
    return { ok: false, message: migrationMessage(message) ?? message }
  }
}

export type WalkUpTicketView = {
  id: string
  shortCode: string
  holderName: string | null
  status: string
  daysLabel: string
  publicUrl: string
  publicToken: string
}

function walkUpView(row: { id: string; shortCode: string; holderName: string | null; status: string; validDays: CostDaySlot[]; publicToken: string }): WalkUpTicketView {
  return {
    id: row.id,
    shortCode: row.shortCode,
    holderName: row.holderName,
    status: row.status,
    daysLabel: validDayLabels(row.validDays),
    publicUrl: ticketPublicUrl(row.publicToken),
    publicToken: row.publicToken,
  }
}

export async function loadPackageWalkUpTickets(packageId: string): Promise<Result<{ tickets: WalkUpTicketView[] }>> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  try {
    const tickets = await loadWalkUpTickets(gate.admin, packageId)
    return { ok: true, message: "Loaded.", tickets: tickets.map(walkUpView) }
  } catch (error) {
    const message = errorMessage(error)
    if (missingTicketingSchema(message) || /walk_up/i.test(message)) {
      return { ok: true, message: "Loaded.", tickets: [] }
    }
    return { ok: false, message }
  }
}

export async function issuePackageWalkUpTicket(input: {
  packageId: string
  holderName?: string
  email?: string
  validDays?: string[]
}): Promise<Result<{ ticket: WalkUpTicketView }>> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  const days = (input.validDays ?? []).filter((day): day is CostDaySlot => isCostDaySlot(day))
  const issued = await issueWalkUpTicket(gate.admin, {
    packageId: input.packageId,
    actorId: gate.profile.id,
    holderName: blank(input.holderName),
    validDays: days.length ? days : undefined,
  })
  if (!issued.ok) return issued
  const ticket = walkUpView(issued.ticket)
  const email = blank(input.email)?.toLowerCase()
  if (email) {
    const sent = await sendWalkUpMail(gate.profile.id, ticket, email, issued.ticket.holderName || "there")
    if (!sent.ok) {
      revalidateGuestList()
      return { ok: true, message: `${issued.message} Email did not send: ${sent.message}`, ticket }
    }
    await markTicketsSentDelivered(gate.admin, { ticketIds: [issued.ticket.id], actorId: gate.profile.id, delivered: true })
  }
  revalidateGuestList()
  revalidatePath("/admin/check-in")
  return { ok: true, message: issued.message, ticket }
}

export async function sendPackageWalkUpTicket(input: {
  ticketId: string
  email: string
}): Promise<Result> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  const email = blank(input.email)?.toLowerCase()
  if (!email) return { ok: false, message: "Enter an email address." }
  const { data, error } = await gate.admin.from("tickets").select("*").eq("id", input.ticketId).maybeSingle()
  if (error || !data) return { ok: false, message: "Ticket not found." }
  const ticket = walkUpView({
    id: String(data.id),
    shortCode: String(data.short_code),
    holderName: typeof data.holder_name === "string" ? data.holder_name : null,
    status: String(data.status),
    validDays: Array.isArray(data.valid_days) ? data.valid_days.filter((day: unknown): day is CostDaySlot => isCostDaySlot(String(day))) : [],
    publicToken: String(data.public_token ?? ""),
  })
  const sent = await sendWalkUpMail(gate.profile.id, ticket, email, ticket.holderName || "there")
  if (!sent.ok) return sent
  await markTicketsSentDelivered(gate.admin, { ticketIds: [ticket.id], actorId: gate.profile.id, delivered: true })
  revalidateGuestList()
  return { ok: true, message: `Sent ${ticket.shortCode} to ${email}.` }
}

export async function voidPackageWalkUpTicket(input: { ticketId: string; reason: string }): Promise<Result> {
  const gate = await guestListGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  const result = await voidAndReissueTicket(gate.admin, {
    ticketId: input.ticketId,
    actorId: gate.profile.id,
    reason: input.reason.trim() || "Walk-up voided",
  })
  if (result.ok) {
    revalidateGuestList()
    revalidatePath("/admin/check-in")
  }
  return result
}

async function sendWalkUpMail(
  _actorId: string,
  ticket: WalkUpTicketView,
  email: string,
  toName: string,
): Promise<Result> {
  const draft = buildOperationsEmailDraft({
    kind: "tickets_ready",
    contactName: toName,
    accountName: "ZK Sports",
    eventLabel: "your hospitality",
    quantity: 1,
    ticketLinksBlock: ticketLinkLine(ticket.holderName || ticket.shortCode, ticket.publicToken),
  })
  const result = await sendTicketClientEmail({
    to: email,
    subject: draft.subject,
    body: draft.body,
  })
  if (!result.ok) return { ok: false, message: result.error ?? result.skipped ?? "Could not send that email." }
  return { ok: true, message: "Sent." }
}
