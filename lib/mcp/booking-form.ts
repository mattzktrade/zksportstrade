import type { SupabaseClient } from "@supabase/supabase-js"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { snapshotToEdits } from "@/lib/booking-forms/edits"
import { generateBookingFormPdf } from "@/lib/booking-forms/pdf"
import { adminDealListPath } from "@/lib/crm/deal-pipeline"
import { sendBookingFormReadyToSendNotification } from "@/lib/email/send-booking-form"
import {
  buildBookingFormSnapshot,
  generateDocumentRef,
  generateSigningToken,
  sha256,
  stableJson,
} from "@/lib/booking-forms/snapshot"
import { uploadBookingDocument } from "@/lib/booking-forms/storage"
import { BOOKING_TEMPLATE_ID } from "@/lib/booking-forms/template"
import { McpToolError, type McpApiKey } from "@/lib/mcp/types"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const UNSIGNED_EDITABLE = new Set(["draft", "failed"])
const DRAFT_TOKEN_DAYS = 30

/**
 * Prepare a native booking form draft and send it to directors for approval.
 * Never emails the client and never countersigns.
 */
export async function mcpCreateBookingForm(
  admin: SupabaseClient,
  key: McpApiKey,
  dealIdRaw: string,
): Promise<unknown> {
  const dealId = dealIdRaw.trim()
  if (!UUID_RE.test(dealId)) throw new McpToolError("deal_id is not a valid id.")

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .select("id, stage, order_id, crm_accounts(name), crm_contacts!primary_contact_id(full_name, email)")
    .eq("id", dealId)
    .maybeSingle()
  if (dealError) throw new McpToolError(dealError.message)
  if (!deal) throw new McpToolError(`Deal not found: ${dealId}.`)
  if (deal.order_id) {
    throw new McpToolError("This deal already has a confirmed order. A booking form is not needed.")
  }

  const { count: lineCount } = await admin
    .from("deal_line_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
  if (!lineCount) {
    throw new McpToolError("Add a product line to this deal before creating a booking form.")
  }

  const { data: blocking } = await admin
    .from("booking_forms")
    .select("id, status")
    .eq("deal_id", dealId)
    .in("status", ["sent", "viewed", "awaiting_zk_signature", "zk_signed", "completed"])
    .limit(1)
  if (blocking?.[0]) {
    throw new McpToolError(
      `A booking form for this deal is already ${blocking[0].status}. The assistant cannot send or approve it.`,
    )
  }

  const now = new Date()
  const { snapshot } = await buildBookingFormSnapshot(admin, dealId, generateDocumentRef(now), now)
  // Validates signer email and terms using the same rules as the staff editor.
  snapshotToEdits(snapshot)

  const { data: existingDrafts } = await admin
    .from("booking_forms")
    .select("id, document_ref, revision")
    .eq("deal_id", dealId)
    .in("status", [...UNSIGNED_EDITABLE])
    .order("revision", { ascending: false })
    .limit(1)
  const existing = existingDrafts?.[0] ?? null
  const documentRef =
    (existing?.document_ref as string | undefined) ?? snapshot.documentRef ?? generateDocumentRef(now)
  const snapshotHash = sha256(stableJson({ ...snapshot, documentRef }))
  const unsignedPdf = await generateBookingFormPdf({ ...snapshot, documentRef })
  const unsignedPath = `forms/${documentRef}/unsigned.pdf`
  await uploadBookingDocument(unsignedPath, unsignedPdf, "application/pdf", true)

  let formId = existing?.id ? String(existing.id) : ""
  if (formId) {
    const { error } = await admin
      .from("booking_forms")
      .update({
        status: "draft",
        snapshot_data: { ...snapshot, documentRef },
        snapshot_hash: snapshotHash,
        client_name: snapshot.billTo.contactName,
        client_email: snapshot.billTo.contactEmail,
        unsigned_pdf_path: unsignedPath,
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", formId)
    if (error) throw new McpToolError(error.message)
  } else {
    const { tokenHash } = generateSigningToken()
    const expiresAt = new Date(now.getTime() + DRAFT_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    const { data: latest } = await admin
      .from("booking_forms")
      .select("id, revision")
      .eq("deal_id", dealId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle()
    const revision = Number(latest?.revision ?? 0) + 1
    const { data: created, error } = await admin
      .from("booking_forms")
      .insert({
        deal_id: dealId,
        template_id: BOOKING_TEMPLATE_ID,
        revision,
        supersedes_id: latest?.id ?? null,
        document_ref: documentRef,
        snapshot_data: { ...snapshot, documentRef },
        snapshot_hash: snapshotHash,
        client_name: snapshot.billTo.contactName,
        client_email: snapshot.billTo.contactEmail,
        client_token_hash: tokenHash,
        client_token_expires_at: expiresAt.toISOString(),
        unsigned_pdf_path: unsignedPath,
        status: "draft",
      })
      .select("id")
      .maybeSingle()
    if (error || !created?.id) {
      throw new McpToolError(error?.message ?? "Could not save the booking form draft.")
    }
    formId = String(created.id)
  }

  await admin.from("booking_form_events").insert({
    booking_form_id: formId,
    event_type: "ready_notified",
    metadata: { mcp: true, key_name: key.name, deal_id: dealId },
  })

  const { error: stageError } = await admin.rpc("mark_deal_awaiting_booking_form_send", {
    p_deal_id: dealId,
  })
  if (stageError) {
    await admin
      .from("deals")
      .update({
        stage: "awaiting_booking_form_send",
        next_action: "Sent for approval to Ollie and Michel",
        next_action_due_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", dealId)
      .in("stage", ["draft", "sourcing", "proposal", "awaiting_booking_form_send"])
  }

  await admin.from("deal_activities").insert({
    deal_id: dealId,
    action: "booking_form_ready_notified",
    summary: "Booking form sent for approval to Ollie and Michel",
    metadata: { booking_form_id: formId, mcp: true, key_name: key.name },
  })

  const email = await sendBookingFormReadyToSendNotification({
    documentRef,
    accountName: snapshot.billTo.accountName,
    eventName: snapshot.deal.title,
    clientName: snapshot.billTo.contactName,
    preparedByName: key.name,
    dealUrl: `${getServerSiteOrigin()}${adminDealListPath(dealId)}`,
  })

  return {
    booking_form_id: formId,
    document_ref: documentRef,
    status: "draft",
    sent_to_client: false,
    awaiting_director_approval: true,
    notification:
      email.ok
        ? "Sent for approval to Ollie and Michel. An admin still needs to send the form to the client."
        : `Booking form is saved as a draft, but the admin notification was not sent: ${email.error ?? email.skipped ?? "email failed"}. An admin still needs to send the form to the client.`,
  }
}
