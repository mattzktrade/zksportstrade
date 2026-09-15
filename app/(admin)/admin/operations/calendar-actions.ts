"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { setPurchaseOrderOpsDates } from "@/lib/admin/purchase-orders"
import type { OperationsCalendarStaffEntry } from "@/lib/operations/calendar"
import { eventDateIso } from "@/lib/operations/fulfilment"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string } | { ok: false; message: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIME_RE = /^\d{2}:\d{2}$/

async function operationsGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  return { profile, supabase: await createClient(), admin: createAdminClient() }
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function parseTime(value: string | null | undefined): string | null {
  const raw = blank(value)
  if (!raw) return null
  const hhmm = raw.slice(0, 5)
  return TIME_RE.test(hhmm) ? hhmm : null
}

function missingTable(message: string): boolean {
  return /operations_calendar_entries/i.test(message)
}

function applySqlMessage(message: string): string {
  return missingTable(message)
    ? "Apply the latest operations calendar SQL in Supabase first, then try again."
    : message
}

function revalidateCalendar() {
  revalidatePath("/admin/operations")
}

export async function loadOperationsCalendarEntries(): Promise<OperationsCalendarStaffEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("operations_calendar_entries")
    .select("id, title, notes, on_date, start_time, end_time, deal_id, order_id")
    .order("on_date")
    .order("start_time")
  if (error) return []
  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    notes: blank(row.notes),
    date: String(row.on_date).slice(0, 10),
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    dealId: row.deal_id ? String(row.deal_id) : null,
    orderId: row.order_id ? String(row.order_id) : null,
  }))
}

export async function saveOperationsCalendarEntry(input: {
  id?: string | null
  title: string
  notes?: string | null
  date: string
  startTime?: string | null
  endTime?: string | null
  dealId?: string | null
  orderId?: string | null
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const title = blank(input.title)
  const date = eventDateIso(input.date)
  if (!title) return { ok: false, message: "Enter a title." }
  if (!date) return { ok: false, message: "Pick a date." }
  const dealId = blank(input.dealId)
  const orderId = blank(input.orderId)
  if (dealId && !UUID_RE.test(dealId)) return { ok: false, message: "Invalid deal." }
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid booking." }
  const payload = {
    title,
    notes: blank(input.notes),
    on_date: date,
    start_time: parseTime(input.startTime),
    end_time: parseTime(input.endTime),
    deal_id: dealId,
    order_id: orderId,
    updated_by: gate.profile.id,
    updated_at: new Date().toISOString(),
  }
  const id = blank(input.id)
  const { error } = id && UUID_RE.test(id)
    ? await gate.admin.from("operations_calendar_entries").update(payload).eq("id", id)
    : await gate.admin.from("operations_calendar_entries").insert({ ...payload, created_by: gate.profile.id })
  if (error) return { ok: false, message: applySqlMessage(error.message) }
  revalidateCalendar()
  return { ok: true, message: id ? "Calendar item updated." : "Added to the calendar." }
}

export async function deleteOperationsCalendarEntry(id: string): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid calendar item." }
  const { error } = await gate.admin.from("operations_calendar_entries").delete().eq("id", id)
  if (error) return { ok: false, message: applySqlMessage(error.message) }
  revalidateCalendar()
  return { ok: true, message: "Removed from the calendar." }
}

export async function saveOperationsCalendarBookingDate(input: {
  kind: "guest_deadline" | "collection"
  date: string
  orderId?: string | null
  dealId?: string | null
  purchaseOrderIds?: string[]
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const date = eventDateIso(input.date)
  if (!date) return { ok: false, message: "Pick a date." }
  const rawOrder = blank(input.orderId)
  const orderId = rawOrder?.startsWith("deal:") ? null : rawOrder
  const dealId = blank(input.dealId)
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid booking." }
  if (dealId && !UUID_RE.test(dealId)) return { ok: false, message: "Invalid deal." }
  if (!orderId && !dealId) return { ok: false, message: "Choose a booking." }

  if (input.kind === "guest_deadline") {
    const poIds = [...new Set((input.purchaseOrderIds ?? []).filter((id) => UUID_RE.test(id)))]
    if (poIds.length) {
      for (const poId of poIds) {
        const result = await setPurchaseOrderOpsDates(gate.admin, poId, { guestDetailsDeadline: date })
        if (!result.ok) return result
      }
    } else {
      const patched = await patchOpsDate(gate.admin, gate.profile.id, orderId, dealId, { guest_details_due_at: date })
      if (!patched.ok) return patched
    }
    revalidateCalendar()
    revalidatePath("/admin/purchase-orders")
    return { ok: true, message: "Guest deadline updated." }
  }

  const patched = await patchOpsDate(gate.admin, gate.profile.id, orderId, dealId, { delivery_due_at: date })
  if (!patched.ok) return patched
  revalidateCalendar()
  return { ok: true, message: "Collection / ship date updated." }
}

async function patchOpsDate(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  profileId: string,
  orderId: string | null,
  dealId: string | null,
  patch: Record<string, string | null>,
): Promise<Result> {
  const now = new Date().toISOString()
  const payload = { ...patch, updated_by: profileId, updated_at: now }
  if (orderId) {
    const { data: existing } = await admin.from("order_operations").select("order_id").eq("order_id", orderId).maybeSingle()
    const { error } = existing
      ? await admin.from("order_operations").update(payload).eq("order_id", orderId)
      : await admin.from("order_operations").insert({ order_id: orderId, ...payload })
    if (error) return { ok: false, message: error.message }
  }
  if (dealId) {
    const { data: current } = await admin
      .from("deal_operations")
      .select("fulfilment_status, guest_details_status, communication_status, supplier_status, delivery_status")
      .eq("deal_id", dealId)
      .maybeSingle()
    const { error } = await admin.from("deal_operations").upsert(
      {
        deal_id: dealId,
        fulfilment_status: current?.fulfilment_status ?? "confirmed",
        guest_details_status: current?.guest_details_status ?? "not_requested",
        communication_status: current?.communication_status ?? "not_started",
        supplier_status: current?.supplier_status ?? "unassigned",
        delivery_status: current?.delivery_status ?? "not_ready",
        ...payload,
      },
      { onConflict: "deal_id" },
    )
    if (error) return { ok: false, message: error.message }
  }
  return { ok: true, message: "Saved." }
}
