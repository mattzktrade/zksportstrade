import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  BookingFormAdminRow,
  BookingFormEventRow,
} from "@/lib/booking-forms/types"

export async function getBookingFormsForDeals(): Promise<{
  forms: BookingFormAdminRow[]
  events: BookingFormEventRow[]
}> {
  noStore()
  const supabase = await createClient()
  const { data: forms, error } = await supabase
    .from("booking_forms")
    .select(
      "id, deal_id, document_ref, revision, status, client_name, client_email, sent_at, first_viewed_at, client_signed_at, zk_signed_at, completed_at, client_token_expires_at, reminder_count, last_reminder_at, last_error, unsigned_pdf_path, final_pdf_path, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500)
  if (error || !forms) return { forms: [], events: [] }

  const formIds = forms.map((form) => String(form.id))
  const { data: events } = formIds.length
    ? await supabase
        .from("booking_form_events")
        .select("id, booking_form_id, event_type, actor_email, metadata, created_at")
        .in("booking_form_id", formIds)
        .order("created_at", { ascending: false })
        .limit(2000)
    : { data: [] }

  return {
    forms: forms as BookingFormAdminRow[],
    events: (events ?? []) as BookingFormEventRow[],
  }
}

export async function listNativeBookingFormsAwaitingApprovalDealIds(): Promise<string[]> {
  noStore()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("booking_forms")
    .select("deal_id")
    .eq("status", "awaiting_zk_signature")
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data.map((row) => String(row.deal_id ?? "")).filter(Boolean)
}

export async function countNativeBookingFormsAwaitingApproval(): Promise<number> {
  noStore()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("booking_forms")
    .select("*", { count: "exact", head: true })
    .eq("status", "awaiting_zk_signature")
  if (error) return 0
  return count ?? 0
}

export async function countNativeBookingFormsReadyToSend(): Promise<number> {
  noStore()
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("deals")
    .select("*", { count: "exact", head: true })
    .eq("stage", "awaiting_booking_form_send")
  if (error) return 0
  return count ?? 0
}

export async function getBookingFormsForDeal(dealId: string): Promise<{
  form: BookingFormAdminRow | null
  events: BookingFormEventRow[]
}> {
  noStore()
  const id = dealId.trim()
  if (!id) return { form: null, events: [] }
  const supabase = await createClient()
  const { data: forms, error } = await supabase
    .from("booking_forms")
    .select(
      "id, deal_id, document_ref, revision, status, client_name, client_email, sent_at, first_viewed_at, client_signed_at, zk_signed_at, completed_at, client_token_expires_at, reminder_count, last_reminder_at, last_error, unsigned_pdf_path, final_pdf_path, created_at",
    )
    .eq("deal_id", id)
    .order("revision", { ascending: false })
    .limit(1)
  if (error || !forms?.[0]) return { form: null, events: [] }
  const form = forms[0] as BookingFormAdminRow
  const { data: events } = await supabase
    .from("booking_form_events")
    .select("id, booking_form_id, event_type, actor_email, metadata, created_at")
    .eq("booking_form_id", form.id)
    .order("created_at", { ascending: false })
  return { form, events: (events ?? []) as BookingFormEventRow[] }
}

