"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { parseGuestTicketStatus, type GuestTicketStatus } from "@/lib/admin/package-guest-list-model"
import { parseAttendanceDay } from "@/lib/guest-details/model"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { saveOrderGuests, deleteOrderGuest } from "@/app/(admin)/admin/operations/actions"

type Result = { ok: true; message: string } | { ok: false; message: string }

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
