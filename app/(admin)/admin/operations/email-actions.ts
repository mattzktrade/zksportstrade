"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { sendOperationsClientEmail } from "@/lib/email/send-operations-email"
import { syncDealWorkflowFromOperations } from "@/lib/operations/sync-deal-workflow"
import { parseAccountKinds } from "@/lib/crm/account-kinds"
import { isDirectClientAccount } from "@/lib/operations/fulfilment"
import { buildOperationsEmailDraft, formatOperationsDeadline, isOperationsEmailKind, operationsEmailKindLabel, type OperationsEmailDraft, type OperationsEmailHistoryRow, type OperationsEmailKind } from "@/lib/operations/emails"
import { loadOperationsEmailTemplates } from "@/app/(admin)/admin/operations/template-actions"
import { ensureGuestDetailsInvite, loadGuestDetailsBookingContext } from "@/lib/guest-details/invite"
import { ensureGuestDetailsLinkInBody, guestDetailsTokenFromText } from "@/lib/guest-details/model"
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
  const selectWithOps = `
      id, reference, order_id, account_id, primary_contact_id, operations_contact_id, owner_profile_id,
      crm_accounts(name, email, account_types),
      crm_contacts!primary_contact_id(full_name, email),
      deal_line_items(
        quantity, sort_order, fulfilment_cost_layer_id,
        packages(name, races(name, season))
      )
    `
  const selectWithoutOps = selectWithOps.replace("operations_contact_id, ", "")
  let { data: deal, error } = await supabase.from("deals").select(selectWithOps).eq("id", dealId).maybeSingle()
  if (error && /operations_contact_id/i.test(error.message)) {
    const retry = await supabase.from("deals").select(selectWithoutOps).eq("id", dealId).maybeSingle()
    deal = retry.data as typeof deal
    error = retry.error
  }
  if (error || !deal) return null
  const account = one(
    deal.crm_accounts as
      | { name: string; email: string | null; account_types?: unknown }
      | { name: string; email: string | null; account_types?: unknown }[]
      | null,
  )
  let contact = one(
    deal.crm_contacts as
      | { full_name: string; email: string | null }
      | { full_name: string; email: string | null }[]
      | null,
  )
  const opsContactId = String((deal as { operations_contact_id?: string | null }).operations_contact_id ?? "")
  if (UUID_RE.test(opsContactId)) {
    const { data: opsContact } = await supabase
      .from("crm_contacts")
      .select("full_name, email")
      .eq("id", opsContactId)
      .maybeSingle()
    if (opsContact) contact = opsContact
  }
  const lines = [...((deal.deal_line_items ?? []) as Array<{
    quantity: number
    sort_order: number
    fulfilment_cost_layer_id?: string | null
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
  const orderId = deal.order_id ? String(deal.order_id) : null
  let collectionPoint: string | null = null
  let collectionTime: string | null = null
  if (orderId) {
    const { data: ops } = await supabase
      .from("order_operations")
      .select("collection_point, collection_time")
      .eq("order_id", orderId)
      .maybeSingle()
    collectionPoint = blank(ops?.collection_point)
    collectionTime = blank(ops?.collection_time)
  } else {
    const { data: ops } = await supabase
      .from("deal_operations")
      .select("collection_point, collection_time")
      .eq("deal_id", dealId)
      .maybeSingle()
    collectionPoint = blank(ops?.collection_point)
    collectionTime = blank(ops?.collection_time)
  }
  const deadline = await loadGuestDeadline(supabase, orderId, lines)
  return {
    dealId: String(deal.id),
    orderId,
    reference: String(deal.reference),
    accountName: account?.name ?? "your company",
    contactName: contact?.full_name ?? account?.name ?? "there",
    contactEmail: blank(contact?.email) ?? blank(account?.email),
    eventLabel: [...new Set(events)].join(", "),
    quantity: quantity || 1,
    collectionPoint,
    collectionTime,
    deadline,
    isDirectClient: isDirectClientAccount(parseAccountKinds(account?.account_types)),
  }
}

async function loadGuestDeadline(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string | null,
  lines: Array<{ fulfilment_cost_layer_id?: string | null }>,
): Promise<string | null> {
  const layerIds = [...new Set(lines.map((line) => line.fulfilment_cost_layer_id).filter((id): id is string => Boolean(id)))]
  if (orderId) {
    const { data } = await supabase.from("order_cost_consumptions").select("cost_layer_id").eq("order_id", orderId)
    for (const row of data ?? []) {
      if (row.cost_layer_id) layerIds.push(String(row.cost_layer_id))
    }
  }
  const uniqueLayers = [...new Set(layerIds)]
  if (!uniqueLayers.length) return null
  const { data: layers } = await supabase.from("package_cost_layers").select("purchase_order_id").in("id", uniqueLayers)
  const poIds = [...new Set((layers ?? []).map((row) => row.purchase_order_id).filter((id): id is string => Boolean(id)))]
  if (!poIds.length) return null
  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("guest_details_deadline")
    .in("id", poIds)
  const dates = (pos ?? [])
    .map((row) => String(row.guest_details_deadline ?? "").slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
  return dates[0] ?? null
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

async function lastGuestDetailsEmailBody(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  dealId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("operations_emails")
    .select("body_text")
    .eq("deal_id", dealId)
    .eq("kind", "guest_details")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.body_text ? String(data.body_text) : null
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
  let formUrl: string | undefined
  if ((input.kind === "guest_details" || input.kind === "guest_details_reminder") && gate.admin) {
    try {
      const booking = await loadGuestDetailsBookingContext(gate.admin, input.dealId)
      const recovered = await lastGuestDetailsEmailBody(gate.admin, input.dealId)
      const invite = await ensureGuestDetailsInvite({
        admin: gate.admin,
        dealId: input.dealId,
        orderId: booking?.orderId ?? context.orderId,
        eventDateIso: booking?.eventDate ?? null,
        recoverFromBody: recovered,
      })
      formUrl = invite?.url
    } catch {
      formUrl = undefined
    }
  }
  const templates = await loadOperationsEmailTemplates()
  const template = templates.find((row) => row.kind === input.kind) ?? null
  const built = buildOperationsEmailDraft({
    kind: input.kind,
    contactName: context.contactName,
    accountName: context.accountName,
    eventLabel: context.eventLabel,
    quantity: context.quantity,
    formUrl,
    collectionPoint: context.collectionPoint,
    collectionTime: context.collectionTime,
    deadline: formatOperationsDeadline(context.deadline),
    template,
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
  let body = blank(input.body)
  if (!EMAIL_RE.test(toEmail)) return { ok: false, message: "Enter a valid recipient email." }
  if (!subject) return { ok: false, message: "Subject is required." }
  if (!body) return { ok: false, message: "Email body is required." }

  const context = await loadDealContext(input.dealId)
  if (!context) return { ok: false, message: "Deal not found." }
  if (input.kind === "after_event" && !context.isDirectClient) {
    return { ok: false, message: "Thank-you emails are for direct clients only." }
  }

  if ((input.kind === "guest_details" || input.kind === "guest_details_reminder") && gate.admin) {
    try {
      const booking = await loadGuestDetailsBookingContext(gate.admin, input.dealId)
      const invite = await ensureGuestDetailsInvite({
        admin: gate.admin,
        dealId: input.dealId,
        orderId: booking?.orderId ?? context.orderId,
        eventDateIso: booking?.eventDate ?? null,
        preferredToken: guestDetailsTokenFromText(body),
        recoverFromBody: body,
      })
      if (invite) body = ensureGuestDetailsLinkInBody(body, invite.url)
    } catch {
      // Keep the drafted body if the invite table is not applied yet.
    }
  }

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
  const guestRequest = kind === "guest_details" || kind === "guest_details_reminder"
  const finalInfo = kind === "names_sent" || kind === "collection_details" || kind === "tickets_sent" || kind === "after_event"
  let nextGuest = "not_requested"
  let deliveryStatus = "not_ready"
  let fulfilmentStatus = "confirmed"
  function communicationFrom(current: string | null | undefined): string {
    if (guestRequest) return "guest_request_sent"
    if (finalInfo) return "final_information_sent"
    if (current && current !== "not_started") return current
    return "booking_confirmation_sent"
  }
  function nextGuestFrom(guestStatus: string): string {
    return guestRequest && ["not_requested", "not_required"].includes(guestStatus) ? "requested" : guestStatus
  }
  if (orderId) {
    const { data: current } = await gate.admin
      .from("order_operations")
      .select("guest_details_status, communication_status, delivery_status, fulfilment_status")
      .eq("order_id", orderId)
      .maybeSingle()
    const guestStatus = current?.guest_details_status ?? "not_requested"
    nextGuest = nextGuestFrom(String(guestStatus))
    deliveryStatus = String(current?.delivery_status ?? "not_ready")
    fulfilmentStatus = String(current?.fulfilment_status ?? "confirmed")
    const communication = communicationFrom(current?.communication_status)
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
      event_type: guestRequest ? "guest_details_requested" : kind === "after_event" ? "after_event_sent" : "operations_email_sent",
      actor_profile_id: gate.profile.id,
      summary:
        kind === "guest_details" || kind === "guest_details_reminder"
          ? "Sent guest details request email"
          : `Sent ${operationsEmailKindLabel(kind).toLowerCase()} email`,
      metadata: { kind },
    })
  } else {
    const { data: current } = await gate.admin
      .from("deal_operations")
      .select("guest_details_status, communication_status, fulfilment_status, supplier_status, delivery_status")
      .eq("deal_id", dealId)
      .maybeSingle()
    const guestStatus = current?.guest_details_status ?? "not_requested"
    nextGuest = nextGuestFrom(String(guestStatus))
    deliveryStatus = String(current?.delivery_status ?? "not_ready")
    fulfilmentStatus = String(current?.fulfilment_status ?? "confirmed")
    const communication = communicationFrom(current?.communication_status)
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
