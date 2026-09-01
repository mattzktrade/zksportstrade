"use server"

import { headers } from "next/headers"
import { revalidateNativeBookingFormPages } from "@/lib/booking-forms/revalidate"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasCmsPermission, canPrepareNativeBookingForm, canSendNativeBookingForm } from "@/lib/auth/permissions"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { generateBookingFormPdf, type PdfSignature } from "@/lib/booking-forms/pdf"
import { syncBookingFormDealInventory } from "@/lib/booking-forms/inventory-sync"
import { getRequestEvidence } from "@/lib/booking-forms/request-evidence"
import {
  buildBookingFormSnapshot,
  generateDocumentRef,
  generateSigningToken,
  sha256,
  stableJson,
} from "@/lib/booking-forms/snapshot"
import {
  createBookingDocumentUrl,
  downloadBookingDocument,
  parseSignaturePng,
  uploadBookingDocument,
} from "@/lib/booking-forms/storage"
import { writeClientSignedBookingPdf } from "@/lib/booking-forms/signed-document"
import {
  readBookingFormSigningToken,
  saveBookingFormSigningToken,
} from "@/lib/booking-forms/signing-token"
import {
  BOOKING_SIGNATURE_CONSENT,
  BOOKING_TEMPLATE_ID,
} from "@/lib/booking-forms/template"
import {
  applyBookingFormEdits,
  snapshotToEdits,
  type BookingFormEdits,
  type BookingFormSendMode,
} from "@/lib/booking-forms/edits"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import {
  sendCompletedBookingFormEmail,
  sendManualNativeBookingFormEmail,
  sendNativeBookingFormEmail,
  sendBookingFormReadyToSendNotification,
} from "@/lib/email/send-booking-form"
import { isNativePlatformMode } from "@/lib/platform/runtime-mode"
import { ensureNativeDealOrderAndInvoice } from "@/lib/crm/deal-order-automation"

type Result =
  | { ok: true; message: string; previewUrl?: string }
  | { ok: false; message: string }
type UrlResult = { ok: true; url: string } | { ok: false; message: string }
type SnapshotResult =
  | { ok: true; snapshot: BookingFormSnapshot; edits: BookingFormEdits }
  | { ok: false; message: string }
type PdfPreviewResult =
  | { ok: true; pdfBase64: string; filename: string }
  | { ok: false; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected booking-form error."
}

function totalLabel(snapshot: BookingFormSnapshot): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: snapshot.currency,
    }).format(snapshot.total)
  } catch {
    return `${snapshot.currency} ${snapshot.total.toFixed(2)}`
  }
}

type BookingFormGateMode = "prepare" | "send" | "void" | "adminSign"

async function bookingFormGate(mode: BookingFormGateMode = "prepare") {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile) return null
  if (mode === "prepare" && !canPrepareNativeBookingForm(profile)) return null
  if (mode === "send" && !canSendNativeBookingForm(profile)) return null
  if (mode === "void" && !hasCmsPermission(profile, "deals.manage") && profile.role !== "admin") {
    return null
  }
  if (mode === "adminSign" && profile.role !== "admin") return null
  return { profile, supabase }
}

type Gate = NonNullable<Awaited<ReturnType<typeof bookingFormGate>>>

function signingUrl(token: string): string {
  return `${getServerSiteOrigin()}/sign/booking/${encodeURIComponent(token)}`
}

const UNSIGNED_EDITABLE_STATUSES = new Set(["draft", "sent", "viewed"])
const DRAFT_STATUSES = new Set(["draft", "failed"])
const DRAFT_TOKEN_DAYS = 30
const SEND_TOKEN_DAYS = 7

function permissionDenied(mode: BookingFormGateMode): { ok: false; message: string } {
  if (mode === "send") {
    return { ok: false, message: "Only an admin can send a booking form to the client." }
  }
  if (mode === "adminSign") {
    return { ok: false, message: "Only an admin can countersign booking forms." }
  }
  return { ok: false, message: "You do not have permission to manage booking forms." }
}

async function persistDraftForm(
  gate: Gate,
  input: {
    dealId: string
    edits: BookingFormEdits
    reissueFromId?: string
  },
): Promise<{ formId: string; snapshot: BookingFormSnapshot }> {
  const id = input.dealId.trim()
  const { data: existingDeal } = await gate.supabase
    .from("deals")
    .select("order_id")
    .eq("id", id)
    .maybeSingle()
  if (existingDeal?.order_id) {
    throw new Error(
      "This deal already has a confirmed order. Portal checkout (or a completed booking form) already confirmed it.",
    )
  }

  let draftId: string | null = null
  if (input.reissueFromId?.trim()) {
    const { data: existing, error: existingError } = await gate.supabase
      .from("booking_forms")
      .select("id, deal_id, status")
      .eq("id", input.reissueFromId.trim())
      .maybeSingle()
    if (existingError || !existing) throw new Error(existingError?.message ?? "Booking form not found.")
    if (String(existing.deal_id) !== id) {
      throw new Error("That booking form does not belong to this deal.")
    }
    const status = String(existing.status)
    if (!UNSIGNED_EDITABLE_STATUSES.has(status) && status !== "failed") {
      throw new Error("Only an unsigned booking form can be edited. Void it first if the client has already signed.")
    }
    if (status === "sent" || status === "viewed") {
      const { error: voidError } = await gate.supabase.rpc("admin_void_native_booking_form", {
        p_booking_form_id: existing.id,
        p_reason: "Reissued after booking form content was edited.",
      })
      if (voidError) throw new Error(voidError.message)
      await syncBookingFormDealInventory(id, "booking_form_voided")
    } else {
      draftId = String(existing.id)
    }
  }

  if (!draftId) {
    const { data: drafts } = await gate.supabase
      .from("booking_forms")
      .select("id")
      .eq("deal_id", id)
      .in("status", ["draft", "failed"])
      .order("revision", { ascending: false })
      .limit(1)
    draftId = drafts?.[0] ? String(drafts[0].id) : null
  }

  const now = new Date()
  const documentRef = draftId
    ? ((
        await gate.supabase.from("booking_forms").select("document_ref").eq("id", draftId).maybeSingle()
      ).data?.document_ref as string | undefined) ?? generateDocumentRef(now)
    : generateDocumentRef(now)
  const { snapshot: base } = await buildBookingFormSnapshot(gate.supabase, id, documentRef, now)
  const snapshot = applyBookingFormEdits(base, input.edits)
  const snapshotHash = sha256(stableJson(snapshot))
  const unsignedPdf = await generateBookingFormPdf(snapshot)
  const unsignedPath = `forms/${documentRef}/unsigned.pdf`
  await uploadBookingDocument(unsignedPath, unsignedPdf, "application/pdf")

  if (draftId) {
    const { error: updateError } = await gate.supabase.rpc("admin_update_native_booking_form_draft", {
      p_booking_form_id: draftId,
      p_snapshot_data: snapshot,
      p_snapshot_hash: snapshotHash,
      p_client_name: snapshot.billTo.contactName,
      p_client_email: snapshot.billTo.contactEmail,
      p_unsigned_pdf_path: unsignedPath,
    })
    if (updateError) throw new Error(updateError.message)
    return { formId: draftId, snapshot }
  }

  const { tokenHash } = generateSigningToken()
  const expiresAt = new Date(now.getTime() + DRAFT_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  const { data: formId, error: createError } = await gate.supabase.rpc("admin_create_native_booking_form", {
    p_deal_id: id,
    p_template_id: BOOKING_TEMPLATE_ID,
    p_document_ref: documentRef,
    p_snapshot_data: snapshot,
    p_snapshot_hash: snapshotHash,
    p_client_name: snapshot.billTo.contactName,
    p_client_email: snapshot.billTo.contactEmail,
    p_client_token_hash: tokenHash,
    p_client_token_expires_at: expiresAt.toISOString(),
    p_unsigned_pdf_path: unsignedPath,
  })
  if (createError || !formId) throw new Error(createError?.message ?? "Could not create booking form.")
  return { formId: String(formId), snapshot }
}

async function sendPersistedForm(
  gate: Gate,
  formId: string,
  sendMode: BookingFormSendMode,
): Promise<Result> {
  const { data: form, error } = await gate.supabase
    .from("booking_forms")
    .select("id, deal_id, status, unsigned_pdf_path, snapshot_data")
    .eq("id", formId)
    .maybeSingle()
  if (error || !form) throw new Error(error?.message ?? "Booking form not found.")
  if (!DRAFT_STATUSES.has(String(form.status))) {
    throw new Error("Only a saved draft booking form can be sent to the client.")
  }
  const snapshot = form.snapshot_data as BookingFormSnapshot
  const now = new Date()
  const { token, tokenHash } = generateSigningToken()
  const expiresAt = new Date(now.getTime() + SEND_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  const { error: sendStateError } = await gate.supabase.rpc("admin_send_native_booking_form", {
    p_booking_form_id: form.id,
    p_client_token_hash: tokenHash,
    p_client_token_expires_at: expiresAt.toISOString(),
  })
  if (sendStateError) throw new Error(sendStateError.message)
  await syncBookingFormDealInventory(String(form.deal_id), "booking_form_sent")
  const persistAdmin = createAdminClient()
  if (persistAdmin) {
    try {
      await saveBookingFormSigningToken(persistAdmin, String(form.id), token)
    } catch (tokenError) {
      console.warn("[booking-forms] could not store signing token:", tokenError)
    }
  }

  let pdf: Uint8Array | undefined
  if (sendMode === "manual_pdf") {
    if (form.unsigned_pdf_path) {
      try {
        pdf = await downloadBookingDocument(String(form.unsigned_pdf_path))
      } catch {
        pdf = await generateBookingFormPdf(snapshot)
      }
    } else {
      pdf = await generateBookingFormPdf(snapshot)
    }
  }
  const emailInput = {
    recipientEmail: snapshot.billTo.contactEmail,
    recipientName: snapshot.billTo.contactName,
    accountName: snapshot.billTo.accountName,
    documentRef: snapshot.documentRef,
    eventName: snapshot.deal.title,
    totalLabel: totalLabel(snapshot),
    signingUrl: signingUrl(token),
    expiresAt: expiresAt.toISOString(),
    pdf,
  }
  const email =
    sendMode === "manual_pdf"
      ? await sendManualNativeBookingFormEmail(emailInput)
      : await sendNativeBookingFormEmail(emailInput)
  if (!email.ok) {
    const detail = email.error ?? email.skipped ?? "Email delivery failed."
    const admin = createAdminClient()
    await admin?.from("booking_forms").update({ last_error: detail }).eq("id", form.id)
    revalidateNativeBookingFormPages(String(form.deal_id))
    return {
      ok: true,
      message: `Booking form created and stock reserved, but email was not sent: ${detail}. Copy the signing link to send it on WhatsApp, or resend after email is configured.`,
      previewUrl: signingUrl(token),
    }
  }

  revalidateNativeBookingFormPages(String(form.deal_id))
  return {
    ok: true,
    message:
      sendMode === "manual_pdf"
        ? "Booking form PDF emailed. Stock is reserved for seven days and a signing link is included."
        : "Booking form sent. Stock is reserved for seven days.",
    previewUrl: signingUrl(token),
  }
}

export async function previewNativeBookingFormSnapshot(input: {
  dealId: string
  bookingFormId?: string
}): Promise<SnapshotResult> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return permissionDenied("prepare")
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  try {
    if (input.bookingFormId?.trim()) {
      const { data: form, error } = await gate.supabase
        .from("booking_forms")
        .select("id, deal_id, status, snapshot_data")
        .eq("id", input.bookingFormId.trim())
        .maybeSingle()
      if (error || !form) throw new Error(error?.message ?? "Booking form not found.")
      if (String(form.deal_id) !== input.dealId.trim()) {
        throw new Error("That booking form does not belong to this deal.")
      }
      const snapshot = form.snapshot_data as BookingFormSnapshot
      return { ok: true, snapshot, edits: snapshotToEdits(snapshot) }
    }
    const now = new Date()
    const { snapshot } = await buildBookingFormSnapshot(
      gate.supabase,
      input.dealId.trim(),
      generateDocumentRef(now),
      now,
    )
    return { ok: true, snapshot, edits: snapshotToEdits(snapshot) }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function previewNativeBookingFormPdf(input: {
  dealId: string
  edits: BookingFormEdits
}): Promise<PdfPreviewResult> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return permissionDenied("prepare")
  try {
    const now = new Date()
    const { snapshot: base } = await buildBookingFormSnapshot(
      gate.supabase,
      input.dealId.trim(),
      generateDocumentRef(now),
      now,
    )
    const snapshot = applyBookingFormEdits(base, input.edits)
    const pdf = await generateBookingFormPdf(snapshot)
    return {
      ok: true,
      pdfBase64: Buffer.from(pdf).toString("base64"),
      filename: `Booking-Form-${snapshot.documentRef}.pdf`,
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function saveNativeBookingFormDraft(input: {
  dealId: string
  edits: BookingFormEdits
  reissueFromId?: string
}): Promise<Result> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return permissionDenied("prepare")
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  const id = input.dealId.trim()
  if (!id) return { ok: false, message: "Choose a deal first." }
  try {
    await persistDraftForm(gate, {
      dealId: id,
      edits: input.edits,
      reissueFromId: input.reissueFromId,
    })
    revalidateNativeBookingFormPages(id)
    return {
      ok: true,
      message:
        "Booking form saved. It is ready for an approved admin to send to the client. Stock is not reserved until it is sent.",
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function notifyNativeBookingFormReady(input: {
  dealId: string
  edits?: BookingFormEdits
  reissueFromId?: string
  bookingFormId?: string
}): Promise<Result> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return permissionDenied("prepare")
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  const id = input.dealId.trim()
  if (!id) return { ok: false, message: "Choose a deal first." }
  try {
    let formId = input.bookingFormId?.trim() || ""
    let snapshot: BookingFormSnapshot | null = null
    if (input.edits) {
      const persisted = await persistDraftForm(gate, {
        dealId: id,
        edits: input.edits,
        reissueFromId: input.reissueFromId,
      })
      formId = persisted.formId
      snapshot = persisted.snapshot
    }
    if (!formId) return { ok: false, message: "Save the booking form before notifying admins." }

    const { error: notifyError } = await gate.supabase.rpc(
      "admin_record_booking_form_ready_notification",
      { p_booking_form_id: formId },
    )
    if (notifyError) throw new Error(notifyError.message)

    if (!snapshot) {
      const { data: form, error } = await gate.supabase
        .from("booking_forms")
        .select("snapshot_data")
        .eq("id", formId)
        .maybeSingle()
      if (error || !form) throw new Error(error?.message ?? "Booking form not found.")
      snapshot = form.snapshot_data as BookingFormSnapshot
    }

    const preparedByName = gate.profile.full_name?.trim() || "A teammate"
    const email = await sendBookingFormReadyToSendNotification({
      documentRef: snapshot.documentRef,
      accountName: snapshot.billTo.accountName,
      eventName: snapshot.deal.title,
      clientName: snapshot.billTo.contactName,
      preparedByName,
      dealUrl: `${getServerSiteOrigin()}/admin/deals/${encodeURIComponent(id)}`,
    })
    if (!email.ok) {
      const detail = email.error ?? email.skipped ?? "Notification email failed."
      revalidateNativeBookingFormPages(id)
      return {
        ok: false,
        message: `Booking form is saved, but the admin notification was not sent: ${detail}`,
      }
    }

    revalidateNativeBookingFormPages(id)
    return {
      ok: true,
      message: "Ollie, Michel, and Matt have been emailed. An admin still needs to send the form to the client.",
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function sendSavedNativeBookingForm(input: {
  bookingFormId: string
  sendMode?: BookingFormSendMode
}): Promise<Result> {
  const gate = await bookingFormGate("send")
  if (!gate) return permissionDenied("send")
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  const sendMode: BookingFormSendMode = input.sendMode === "manual_pdf" ? "manual_pdf" : "signing_link"
  try {
    return await sendPersistedForm(gate, input.bookingFormId.trim(), sendMode)
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function createAndSendNativeBookingForm(input: {
  dealId: string
  edits: BookingFormEdits
  sendMode?: BookingFormSendMode
  reissueFromId?: string
}): Promise<Result> {
  const gate = await bookingFormGate("send")
  if (!gate) return permissionDenied("send")
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  const id = input.dealId.trim()
  if (!id) return { ok: false, message: "Choose a deal first." }
  const sendMode: BookingFormSendMode = input.sendMode === "manual_pdf" ? "manual_pdf" : "signing_link"
  try {
    const persisted = await persistDraftForm(gate, {
      dealId: id,
      edits: input.edits,
      reissueFromId: input.reissueFromId,
    })
    return await sendPersistedForm(gate, persisted.formId, sendMode)
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function resendNativeBookingForm(bookingFormId: string): Promise<Result> {
  const gate = await bookingFormGate("send")
  if (!gate) return permissionDenied("send")
  try {
    const { data: form, error } = await gate.supabase
      .from("booking_forms")
      .select("id, deal_id, status, client_token_hash, client_token_expires_at, snapshot_data")
      .eq("id", bookingFormId)
      .maybeSingle()
    if (error || !form) throw new Error(error?.message ?? "Booking form not found.")
    if (!["sent", "viewed"].includes(String(form.status))) {
      throw new Error("Only an unsigned active booking form can be resent.")
    }
    if (new Date(form.client_token_expires_at).getTime() <= Date.now()) {
      throw new Error("This booking form has expired. Create a new revision.")
    }
    const snapshot = form.snapshot_data as BookingFormSnapshot
    const previousToken = await readBookingFormSigningToken(gate.supabase, form.id)
    const { token, tokenHash } = generateSigningToken()
    const admin = createAdminClient()
    if (!admin) throw new Error("Supabase service role is not configured.")
    await saveBookingFormSigningToken(admin, form.id, token, {
      client_token_hash: tokenHash,
      last_error: null,
    })

    const email = await sendNativeBookingFormEmail({
      recipientEmail: snapshot.billTo.contactEmail,
      recipientName: snapshot.billTo.contactName,
      accountName: snapshot.billTo.accountName,
      documentRef: snapshot.documentRef,
      eventName: snapshot.deal.title,
      totalLabel: totalLabel(snapshot),
      signingUrl: signingUrl(token),
      expiresAt: form.client_token_expires_at,
    })
    if (!email.ok) {
      const detail = email.error ?? email.skipped ?? "Email delivery failed."
      await saveBookingFormSigningToken(
        admin,
        form.id,
        previousToken ?? "",
        { client_token_hash: form.client_token_hash, last_error: detail },
      )
      throw new Error(detail)
    }
    revalidateNativeBookingFormPages(form.deal_id ? String(form.deal_id) : null)
    return {
      ok: true,
      message: "A new secure signing link was emailed to the client.",
      previewUrl: signingUrl(token),
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function voidNativeBookingForm(
  bookingFormId: string,
  reason: string,
): Promise<Result> {
  const gate = await bookingFormGate("void")
  if (!gate) return permissionDenied("void")
  try {
    const { data: form } = await gate.supabase
      .from("booking_forms")
      .select("deal_id")
      .eq("id", bookingFormId)
      .maybeSingle()
    const { error } = await gate.supabase.rpc("admin_void_native_booking_form", {
      p_booking_form_id: bookingFormId,
      p_reason: reason.trim(),
    })
    if (error) throw new Error(error.message)
    if (form?.deal_id) {
      await syncBookingFormDealInventory(String(form.deal_id), "booking_form_voided")
    }
    revalidateNativeBookingFormPages(form?.deal_id ? String(form.deal_id) : null)
    return { ok: true, message: "Booking form voided and reserved stock released." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function signNativeBookingFormAsAdmin(input: {
  bookingFormId: string
  signerName: string
  signatureDataUrl: string
}): Promise<Result> {
  const gate = await bookingFormGate("adminSign")
  if (!gate) return permissionDenied("adminSign")
  try {
    const { data: auth } = await gate.supabase.auth.getUser()
    const signerEmail = auth.user?.email?.trim().toLowerCase()
    if (!signerEmail) throw new Error("Your admin account does not have an email address.")
    const signerName = input.signerName.trim() || gate.profile.full_name?.trim()
    if (!signerName) throw new Error("Enter the admin signer's full name.")

    const { data: form, error: formError } = await gate.supabase
      .from("booking_forms")
      .select("id, deal_id, document_ref, status, snapshot_hash, snapshot_data")
      .eq("id", input.bookingFormId)
      .maybeSingle()
    if (formError || !form) throw new Error(formError?.message ?? "Booking form not found.")
    if (!["awaiting_zk_signature", "zk_signed"].includes(String(form.status))) {
      throw new Error("The client must sign before a ZK admin.")
    }

    const signatureBytes = parseSignaturePng(input.signatureDataUrl)
    const signatureHash = sha256(signatureBytes)
    const evidenceHash = sha256(
      stableJson({
        bookingFormId: form.id,
        signerRole: "zk_admin",
        signerName,
        signerEmail,
        signatureHash,
        snapshotHash: form.snapshot_hash,
      }),
    )
    const signaturePath = `forms/${form.document_ref}/signatures/zk-admin-${signatureHash.slice(0, 16)}.png`
    if (form.status !== "zk_signed") {
      const requestHeaders = await headers()
      const requestEvidence = getRequestEvidence(requestHeaders)
      await uploadBookingDocument(signaturePath, signatureBytes, "image/png", true)
      const { error: signError } = await gate.supabase.rpc("admin_record_zk_signature", {
        p_booking_form_id: form.id,
        p_signer_name: signerName,
        p_signer_email: signerEmail,
        p_signature_path: signaturePath,
        p_signature_sha256: signatureHash,
        p_evidence_hash: evidenceHash,
        p_consent_text: BOOKING_SIGNATURE_CONSENT,
        p_ip_address: requestEvidence.ipAddress,
        p_location: requestEvidence.location,
        p_user_agent: requestEvidence.userAgent,
      })
      if (signError) throw new Error(signError.message)
    }

    const { data: signatures, error: signaturesError } = await gate.supabase
      .from("booking_form_signatures")
      .select(
        "signer_role, signer_name, signer_email, signature_path, signed_at, ip_address, location, user_agent, evidence_hash",
      )
      .eq("booking_form_id", form.id)
    if (signaturesError || !signatures) {
      throw new Error(signaturesError?.message ?? "Could not load signature evidence.")
    }
    const byRole = new Map(signatures.map((row) => [String(row.signer_role), row]))
    const clientRow = byRole.get("client")
    const adminRow = byRole.get("zk_admin")
    if (!clientRow || !adminRow) throw new Error("Both signatures are required.")

    const toPdfSignature = async (
      row: NonNullable<typeof clientRow>,
      role: "client" | "zk_admin",
    ): Promise<PdfSignature> => ({
      signerRole: role,
      signerName: String(row.signer_name),
      signerEmail: String(row.signer_email),
      signaturePath: String(row.signature_path),
      signedAt: String(row.signed_at),
      ipAddress: row.ip_address ? String(row.ip_address) : null,
      location: row.location ? String(row.location) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      evidenceHash: String(row.evidence_hash),
      pngBytes: await downloadBookingDocument(String(row.signature_path)),
    })
    const [clientSignature, adminSignature] = await Promise.all([
      toPdfSignature(clientRow, "client"),
      toPdfSignature(adminRow, "zk_admin"),
    ])
    const snapshot = form.snapshot_data as BookingFormSnapshot
    const finalPdf = await generateBookingFormPdf(snapshot, {
      client: clientSignature,
      zkAdmin: adminSignature,
    })
    const finalPath = `forms/${form.document_ref}/completed.pdf`
    await uploadBookingDocument(finalPath, finalPdf, "application/pdf", true)
    const { error: finalError } = await gate.supabase.rpc("admin_finalize_native_booking_form", {
      p_booking_form_id: form.id,
      p_final_pdf_path: finalPath,
    })
    if (finalError) throw new Error(finalError.message)

    let invoiceWarning: string | null = null
    try {
      const orderResult = await ensureNativeDealOrderAndInvoice(String(form.deal_id))
      invoiceWarning = orderResult.warning ?? null
    } catch (automationError) {
      invoiceWarning = errorMessage(automationError)
      const admin = createAdminClient()
      await admin
        ?.from("deals")
        .update({
          stage: "signed",
          next_action: "Retry native order and Xero invoice creation",
          next_action_due_at: new Date().toISOString(),
        })
        .eq("id", form.deal_id)
    }

    const email = await sendCompletedBookingFormEmail({
      clientEmail: snapshot.billTo.contactEmail,
      clientName: snapshot.billTo.contactName,
      adminEmail: signerEmail,
      documentRef: snapshot.documentRef,
      eventName: snapshot.deal.title,
      pdf: finalPdf,
    })
    if (!email.ok) {
      const detail = email.error ?? email.skipped ?? "Completion email failed."
      const admin = createAdminClient()
      await admin?.from("booking_forms").update({ last_error: detail }).eq("id", form.id)
    } else {
      const admin = createAdminClient()
      await admin?.from("booking_forms").update({ last_error: null }).eq("id", form.id)
    }

    revalidateNativeBookingFormPages(String(form.deal_id))
    return {
      ok: true,
      message: invoiceWarning
        ? `Booking form completed, but order/invoice automation needs attention: ${invoiceWarning}`
        : email.ok
          ? "Booking form completed, order created, and Xero invoice queued."
          : "Booking form and order completed; the agreement email could not be sent.",
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function getNativeBookingFormSigningUrl(bookingFormId: string): Promise<
  | { ok: true; url: string; rotated: boolean }
  | { ok: false; message: string }
> {
  const gate = await bookingFormGate("send")
  if (!gate) return permissionDenied("send")
  const id = bookingFormId.trim()
  if (!id) return { ok: false, message: "Booking form not found." }
  try {
    const { data: form, error } = await gate.supabase
      .from("booking_forms")
      .select("id, status, client_token_expires_at")
      .eq("id", id)
      .maybeSingle()
    if (error || !form) throw new Error(error?.message ?? "Booking form not found.")
    if (!["sent", "viewed"].includes(String(form.status))) {
      throw new Error("A signing link is only available while the form is waiting for the client.")
    }
    if (new Date(form.client_token_expires_at).getTime() <= Date.now()) {
      throw new Error("This booking form has expired. Create a new revision.")
    }
    const existing = await readBookingFormSigningToken(gate.supabase, form.id)
    if (existing) {
      return { ok: true, url: signingUrl(existing), rotated: false }
    }
    const { token, tokenHash } = generateSigningToken()
    const admin = createAdminClient()
    if (!admin) throw new Error("Supabase service role is not configured.")
    await saveBookingFormSigningToken(admin, form.id, token, { client_token_hash: tokenHash })
    return { ok: true, url: signingUrl(token), rotated: true }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function getNativeBookingFormDownloadUrl(bookingFormId: string): Promise<UrlResult> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return permissionDenied("prepare")
  const { data: form, error } = await gate.supabase
    .from("booking_forms")
    .select("document_ref, status, snapshot_data, final_pdf_path, unsigned_pdf_path")
    .eq("id", bookingFormId)
    .maybeSingle()
  if (error || !form) return { ok: false, message: error?.message ?? "Booking form not found." }

  try {
    if (form.final_pdf_path) {
      return { ok: true, url: await createBookingDocumentUrl(String(form.final_pdf_path)) }
    }

    if (["awaiting_zk_signature", "zk_signed"].includes(String(form.status))) {
      const { data: signatures, error: signaturesError } = await gate.supabase
        .from("booking_form_signatures")
        .select(
          "signer_role, signer_name, signer_email, signature_path, signed_at, ip_address, location, user_agent, evidence_hash",
        )
        .eq("booking_form_id", bookingFormId)
      if (signaturesError) throw new Error(signaturesError.message)
      const clientRow = (signatures ?? []).find((row) => row.signer_role === "client")
      if (clientRow) {
        const snapshot = form.snapshot_data as BookingFormSnapshot
        const clientSignedPath = `forms/${form.document_ref}/client-signed.pdf`
        await writeClientSignedBookingPdf({
          snapshot,
          unsignedPath: clientSignedPath,
          clientSignature: clientRow,
        })
        return { ok: true, url: await createBookingDocumentUrl(clientSignedPath) }
      }
    }

    const path = form.unsigned_pdf_path
    if (!path) return { ok: false, message: "The booking-form PDF is not available." }
    return { ok: true, url: await createBookingDocumentUrl(path) }
  } catch (downloadError) {
    return { ok: false, message: errorMessage(downloadError) }
  }
}

export async function recordBookingFormEmailError(
  bookingFormId: string,
  message: string | null,
): Promise<void> {
  const gate = await bookingFormGate("prepare")
  if (!gate) return
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from("booking_forms")
    .update({ last_error: message?.slice(0, 1000) ?? null })
    .eq("id", bookingFormId)
}

