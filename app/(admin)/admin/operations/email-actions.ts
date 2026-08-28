"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { sendOperationsClientEmail } from "@/lib/email/send-operations-email"
import { syncDealWorkflowFromOperations } from "@/lib/operations/sync-deal-workflow"
import {
  buildOperationsEmailDraft,
  isOperationsEmailKind,
  operationsEmailKindLabel,
  type OperationsEmailDraft,
  type OperationsEmailHistoryRow,
  type OperationsEmailKind,
} from "@/lib/operations/emails"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { eventSeasonLabel } from "@/lib/catalog/event-label"

type Result<T extends object = object> =
  | ({ ok: true; message: string } & T)
  | { ok: false; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function operationsGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  return { profile, supabase: await createClient(), admin: createAdminClient() }
}

async function loadDealContext(dealId: string) {
  const supabase = await createClient()
  const { data: deal, error } = await supabase
    .from("deals")
    .select(
      `
      id, reference, order_id, account_id, primary_contact_id, owner_profile_id,
      crm_accounts(name, email),
      crm_contacts(full_name, email),
      deal_line_items(
        quantity, sort_order,
        packages(name, races(name, season))
      )
    `,
    )
    .eq("id", dealId)
    .maybeSingle()
  if (error || !deal) return null
  const account = one(deal.crm_accounts as { name: string; email: string | null } | { name: string; email: string | null }[] | null)
  const contact = one(
    deal.crm_contacts as
      | { full_name: string; email: string | null }
      | { full_name: string; email: string | null }[]
      | null,
  )
  const lines = [...((deal.deal_line_items ?? []) as Array<{
    quantity: number
    sort_order: number
    packages:
      | { name: string; races: { name: string; season: number } | { name: string; season: number }[] | null }
      | Array<{ name: string; races: { name: string; season: number } | { name: string; season: number }[] | null }>
      | null
  }>)].sort((a, b) => a.sort_order - b.sort_order)
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
  const events = lines.map((line) => {
    const pkg = one(line.packages)
    const race = one(pkg?.races ?? null)
    if (race) return eventSeasonLabel(race.name, race.season)
    return pkg?.name ?? ""
  }).filter(Boolean)
  return {
    dealId: String(deal.id),
    orderId: deal.order_id ? String(deal.order_id) : null,
    reference: String(deal.reference),
    accountName: account?.name ?? "your company",
    contactName: contact?.full_name ?? account?.name ?? "there",
    contactEmail: blank(contact?.email) ?? blank(account?.email),
    eventLabel: [...new Set(events)].join(", "),
    quantity: quantity || 1,
  }
}

function mapHistory(
  rows: Array<{
    id: string
    deal_id: string | null
    order_id: string | null
    kind: string
    to_email: string
    to_name: string | null
    subject: string
    sent_at: string
    sent_by: string | null
  }>,
  names: Map<string, string>,
): OperationsEmailHistoryRow[] {
  return rows
    .filter((row): row is typeof row & { kind: OperationsEmailKind } => isOperationsEmailKind(row.kind))
    .map((row) => ({
      id: String(row.id),
      dealId: row.deal_id ? String(row.deal_id) : null,
      orderId: row.order_id ? String(row.order_id) : null,
      kind: row.kind,
      toEmail: String(row.to_email),
      toName: row.to_name,
      subject: String(row.subject),
      sentAt: String(row.sent_at),
      sentByName: row.sent_by ? names.get(row.sent_by) ?? null : null,
    }))
}

async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dealId: string,
  kind: OperationsEmailKind,
): Promise<OperationsEmailHistoryRow[]> {
  const { data, error } = await supabase
    .from("operations_emails")
    .select("id, deal_id, order_id, kind, to_email, to_name, subject, sent_at, sent_by")
    .eq("deal_id", dealId)
    .eq("kind", kind)
    .order("sent_at", { ascending: false })
    .limit(20)
  if (error || !data?.length) return []
  const senderIds = [...new Set(data.map((row) => row.sent_by).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (senderIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", senderIds)
    for (const profile of profiles ?? []) {
      names.set(String(profile.id), String(profile.full_name ?? "").trim())
    }
  }
  return mapHistory(data, names)
}

export async function previewOperationsEmail(input: {
  dealId: string
  kind: string
}): Promise<Result<{ draft: OperationsEmailDraft; history: OperationsEmailHistoryRow[] }>> {
  const gate = await operationsGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(input.dealId) || !isOperationsEmailKind(input.kind)) {
    return { ok: false, message: "Choose a valid deal and email type." }
  }
  const context = await loadDealContext(input.dealId)
  if (!context) return { ok: false, message: "Deal not found." }
  const built = buildOperationsEmailDraft({
    kind: input.kind,
    contactName: context.contactName,
    accountName: context.accountName,
    eventLabel: context.eventLabel,
    quantity: context.quantity,
  })
  const history = await loadHistory(gate.supabase, input.dealId, input.kind)
  return {
    ok: true,
    message: "Draft ready.",
    draft: {
      ...built,
      toEmail: context.contactEmail ?? "",
    },
    history,
  }
}

export async function sendOperationsEmail(input: {
  dealId: string
  kind: string
  toEmail: string
  toName?: string | null
  subject: string
  body: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(input.dealId) || !isOperationsEmailKind(input.kind)) {
    return { ok: false, message: "Choose a valid deal and email type." }
  }
  const toEmail = blank(input.toEmail)?.toLowerCase() ?? ""
  const subject = blank(input.subject)
  const body = blank(input.body)
  if (!EMAIL_RE.test(toEmail)) return { ok: false, message: "Enter a valid recipient email." }
  if (!subject) return { ok: false, message: "Subject is required." }
  if (!body) return { ok: false, message: "Email body is required." }

  const context = await loadDealContext(input.dealId)
  if (!context) return { ok: false, message: "Deal not found." }

  const sent = await sendOperationsClientEmail({ to: toEmail, subject, body })
  if (!sent.ok) {
    return { ok: false, message: sent.error ?? sent.skipped ?? "The email could not be sent." }
  }

  const { error: insertError } = await gate.admin.from("operations_emails").insert({
    deal_id: context.dealId,
    order_id: context.orderId,
    kind: input.kind,
    to_email: toEmail,
    to_name: blank(input.toName) ?? context.contactName,
    subject,
    body_text: body,
    sent_by: gate.profile.id,
  })
  if (insertError) {
    const missingTable =
      insertError.code === "42P01" ||
      insertError.code === "PGRST205" ||
      /operations_emails/i.test(insertError.message)
    return {
      ok: false,
      message: missingTable
        ? "Apply the operations_emails SQL in Supabase first, then send again."
        : insertError.message,
    }
  }

  await markOperationsAfterSend(gate, context.dealId, context.orderId, input.kind)

  revalidatePath("/admin/operations")
  revalidatePath("/admin/deals", "layout")
  revalidatePath(`/admin/deals/${context.dealId}`)
  return {
    ok: true,
    message: `${operationsEmailKindLabel(input.kind)} sent to ${toEmail}.`,
  }
}

async function markOperationsAfterSend(
  gate: NonNullable<Awaited<ReturnType<typeof operationsGate>>>,
  dealId: string,
  orderId: string | null,
  kind: OperationsEmailKind,
) {
  if (!gate.admin) return
  let nextGuest = "not_requested"
  let deliveryStatus = "not_ready"
  let fulfilmentStatus = "confirmed"
  if (orderId) {
    const { data: current } = await gate.admin
      .from("order_operations")
      .select("guest_details_status, communication_status, delivery_status, fulfilment_status")
      .eq("order_id", orderId)
      .maybeSingle()
    const guestStatus = current?.guest_details_status ?? "not_requested"
    nextGuest =
      kind === "guest_details" && ["not_requested", "not_required"].includes(String(guestStatus))
        ? "requested"
        : String(guestStatus)
    deliveryStatus = String(current?.delivery_status ?? "not_ready")
    fulfilmentStatus = String(current?.fulfilment_status ?? "confirmed")
    const communication =
      kind === "guest_details"
        ? "guest_request_sent"
        : current?.communication_status && current.communication_status !== "not_started"
          ? current.communication_status
          : "booking_confirmation_sent"
    if (current) {
      await gate.admin
        .from("order_operations")
        .update({
          guest_details_status: nextGuest,
          communication_status: communication,
          updated_by: gate.profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId)
    } else {
      await gate.admin.from("order_operations").insert({
        order_id: orderId,
        guest_details_status: nextGuest,
        communication_status: communication,
        updated_by: gate.profile.id,
      })
    }
    await gate.admin.from("order_operation_events").insert({
      order_id: orderId,
      event_type: kind === "guest_details" ? "guest_details_requested" : "operations_intro_sent",
      actor_profile_id: gate.profile.id,
      summary:
        kind === "guest_details"
          ? "Sent guest details request email"
          : "Sent operations introduction email",
      metadata: { kind },
    })
  } else {
    const { data: current } = await gate.admin
      .from("deal_operations")
      .select("guest_details_status, communication_status, fulfilment_status, supplier_status, delivery_status")
      .eq("deal_id", dealId)
      .maybeSingle()
    const guestStatus = current?.guest_details_status ?? "not_requested"
    nextGuest =
      kind === "guest_details" && ["not_requested", "not_required"].includes(String(guestStatus))
        ? "requested"
        : String(guestStatus)
    deliveryStatus = String(current?.delivery_status ?? "not_ready")
    fulfilmentStatus = String(current?.fulfilment_status ?? "confirmed")
    const communication =
      kind === "guest_details"
        ? "guest_request_sent"
        : current?.communication_status && current.communication_status !== "not_started"
          ? current.communication_status
          : "booking_confirmation_sent"
    await gate.admin.from("deal_operations").upsert(
      {
        deal_id: dealId,
        fulfilment_status: current?.fulfilment_status ?? "confirmed",
        guest_details_status: nextGuest,
        communication_status: communication,
        supplier_status: current?.supplier_status ?? "unassigned",
        delivery_status: current?.delivery_status ?? "not_ready",
        updated_by: gate.profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" },
    )
  }

  await syncDealWorkflowFromOperations(gate.admin, {
    actorProfileId: gate.profile.id,
    dealId,
    orderId,
    guestDetailsStatus: nextGuest,
    deliveryStatus,
    fulfilmentStatus,
  })
}
