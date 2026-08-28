"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
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

async function bookingFormGate(adminOnly = false) {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) return null
  if (adminOnly && profile.role !== "admin") return null
  return { profile, supabase }
}

function signingUrl(token: string): string {
  return `${getServerSiteOrigin()}/sign/booking/${encodeURIComponent(token)}`
}

const UNSIGNED_EDITABLE_STATUSES = new Set(["draft", "sent", "viewed"])

export async function previewNativeBookingFormSnapshot(input: {
  dealId: string
  bookingFormId?: string
}): Promise<SnapshotResult> {
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
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
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
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

export async function createAndSendNativeBookingForm(input: {
  dealId: string
  edits: BookingFormEdits
  sendMode?: BookingFormSendMode
  reissueFromId?: string
}): Promise<Result> {
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
  if (!isNativePlatformMode()) {
    return { ok: false, message: "Native booking forms are available only in native platform mode." }
  }
  const id = input.dealId.trim()
  if (!id) return { ok: false, message: "Choose a deal first." }
  const sendMode: BookingFormSendMode = input.sendMode === "manual_pdf" ? "manual_pdf" : "signing_link"
  const { data: existingDeal } = await gate.supabase
    .from("deals")
    .select("order_id, source")
    .eq("id", id)
    .maybeSingle()
  if (existingDeal?.order_id) {
    return {
      ok: false,
      message: "This deal already has a confirmed order. Portal checkout (or a completed booking form) already confirmed it.",
    }
  }

  try {
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
      if (!UNSIGNED_EDITABLE_STATUSES.has(String(existing.status))) {
        throw new Error("Only an unsigned booking form can be edited. Void it first if the client has already signed.")
      }
      const { error: voidError } = await gate.supabase.rpc("admin_void_native_booking_form", {
        p_booking_form_id: existing.id,
        p_reason: "Reissued after booking form content was edited.",
      })
      if (voidError) throw new Error(voidError.message)
      await syncBookingFormDealInventory(id, "booking_form_voided")
    }

    const now = new Date()
    const documentRef = generateDocumentRef(now)
    const { snapshot: base } = await buildBookingFormSnapshot(
      gate.supabase,
      id,
      documentRef,
      now,
    )
    const snapshot = applyBookingFormEdits(base, input.edits)
    const snapshotHash = sha256(stableJson(snapshot))
    const { token, tokenHash } = generateSigningToken()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const unsignedPdf = await generateBookingFormPdf(snapshot)
    const unsignedPath = `forms/${documentRef}/unsigned.pdf`
    await uploadBookingDocument(unsignedPath, unsignedPdf, "application/pdf")

    const { data: formId, error: createError } = await gate.supabase.rpc(
      "admin_create_native_booking_form",
      {
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
      },
    )
    if (createError || !formId) throw new Error(createError?.message ?? "Could not create booking form.")

    const { error: sendStateError } = await gate.supabase.rpc("admin_send_native_booking_form", {
      p_booking_form_id: formId,
    })
    if (sendStateError) throw new Error(sendStateError.message)
    await syncBookingFormDealInventory(id, "booking_form_sent")
    const persistAdmin = createAdminClient()
    if (persistAdmin) {
      try {
        await saveBookingFormSigningToken(persistAdmin, String(formId), token)
      } catch (tokenError) {
        console.warn("[booking-forms] could not store signing token:", tokenError)
      }
    }

    const emailInput = {
      recipientEmail: snapshot.billTo.contactEmail,
      recipientName: snapshot.billTo.contactName,
      accountName: snapshot.billTo.accountName,
      documentRef,
      eventName: snapshot.deal.title,
      totalLabel: totalLabel(snapshot),
      signingUrl: signingUrl(token),
      expiresAt: expiresAt.toISOString(),
      pdf: sendMode === "manual_pdf" ? unsignedPdf : undefined,
    }
    const email =
      sendMode === "manual_pdf"
        ? await sendManualNativeBookingFormEmail(emailInput)
        : await sendNativeBookingFormEmail(emailInput)
    if (!email.ok) {
      const detail = email.error ?? email.skipped ?? "Email delivery failed."
      const admin = createAdminClient()
      await admin?.from("booking_forms").update({ last_error: detail }).eq("id", formId)
      revalidatePath("/admin/deals")
      return {
        ok: true,
        message: `Booking form created and stock reserved, but email was not sent: ${detail}. Copy the signing link to send it on WhatsApp, or resend after email is configured.`,
        previewUrl: signingUrl(token),
      }
    }

    revalidatePath("/admin/deals")
    return {
      ok: true,
      message:
        sendMode === "manual_pdf"
          ? "Booking form PDF emailed. Stock is reserved for seven days and a signing link is included."
          : "Booking form sent. Stock is reserved for seven days.",
      previewUrl: signingUrl(token),
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function resendNativeBookingForm(bookingFormId: string): Promise<Result> {
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
  try {
    const { data: form, error } = await gate.supabase
      .from("booking_forms")
      .select("id, status, client_token_hash, client_token_expires_at, snapshot_data")
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
    revalidatePath("/admin/deals")
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
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
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
    revalidatePath("/admin/deals")
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
  const gate = await bookingFormGate(true)
  if (!gate) return { ok: false, message: "Only an admin can countersign booking forms." }
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

    revalidatePath("/admin/deals")
    revalidatePath("/admin")
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
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to manage deals." }
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
  const gate = await bookingFormGate()
  if (!gate) return { ok: false, message: "You do not have permission to view booking forms." }
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
  const gate = await bookingFormGate()
  if (!gate) return
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from("booking_forms")
    .update({ last_error: message?.slice(0, 1000) ?? null })
    .eq("id", bookingFormId)
}

