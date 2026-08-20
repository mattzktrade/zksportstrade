import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  sha256,
  stableJson,
} from "@/lib/booking-forms/snapshot"
import {
  parseSignaturePng,
  uploadBookingDocument,
} from "@/lib/booking-forms/storage"
import { writeClientSignedBookingPdf } from "@/lib/booking-forms/signed-document"
import { BOOKING_SIGNATURE_CONSENT } from "@/lib/booking-forms/template"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import { sendClientSignedBookingFormNotification } from "@/lib/email/send-booking-form"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { getRequestEvidence } from "@/lib/booking-forms/request-evidence"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const signerName = String(body.signerName ?? "").trim()
    const signerEmail = String(body.signerEmail ?? "").trim().toLowerCase()
    const signatureDataUrl = String(body.signatureDataUrl ?? "")
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 })
    }
    if (signerName.length < 2 || signerName.length > 160) {
      return NextResponse.json({ error: "Enter your full name." }, { status: 400 })
    }
    if (signerEmail.length < 3 || signerEmail.length > 320) {
      return NextResponse.json({ error: "The signer email is invalid." }, { status: 400 })
    }
    if (body.consent !== true) {
      return NextResponse.json(
        { error: "You must agree to the booking form and electronic signature consent." },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    if (!admin) {
      return NextResponse.json({ error: "Signing service is not configured." }, { status: 503 })
    }
    const tokenHash = sha256(token)
    const { data: form, error: formError } = await admin
      .from("booking_forms")
      .select(
        "id, deal_id, document_ref, status, client_email, client_token_expires_at, snapshot_hash, snapshot_data, unsigned_pdf_path",
      )
      .eq("client_token_hash", tokenHash)
      .maybeSingle()
    if (formError || !form) {
      return NextResponse.json({ error: "Invalid or expired signing link." }, { status: 404 })
    }
    if (form.status === "awaiting_zk_signature") {
      return NextResponse.json({ ok: true, alreadySigned: true })
    }
    if (!["sent", "viewed"].includes(String(form.status))) {
      return NextResponse.json({ error: "This booking form can no longer be signed." }, { status: 409 })
    }
    if (new Date(form.client_token_expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This signing link has expired." }, { status: 410 })
    }
    if (signerEmail !== String(form.client_email).trim().toLowerCase()) {
      return NextResponse.json(
        { error: "The signer email must match the recipient email." },
        { status: 400 },
      )
    }

    const signatureBytes = parseSignaturePng(signatureDataUrl)
    const signatureHash = sha256(signatureBytes)
    const evidenceHash = sha256(
      stableJson({
        bookingFormId: form.id,
        signerRole: "client",
        signerName,
        signerEmail,
        signatureHash,
        snapshotHash: form.snapshot_hash,
      }),
    )
    const signaturePath = `forms/${form.document_ref}/signatures/client-${signatureHash.slice(0, 16)}.png`
    await uploadBookingDocument(signaturePath, signatureBytes, "image/png", true)

    const requestEvidence = getRequestEvidence(request.headers)
    const { error: signError } = await admin.rpc("record_native_client_signature", {
      p_token_hash: tokenHash,
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
    if (signError) {
      const message = signError.message.toLowerCase()
      const status = message.includes("expired") ? 410 : message.includes("not_signable") ? 409 : 400
      return NextResponse.json({ error: signError.message }, { status })
    }

    const snapshot = form.snapshot_data as BookingFormSnapshot
    const { data: clientSignature } = await admin
      .from("booking_form_signatures")
      .select(
        "signer_role, signer_name, signer_email, signature_path, signed_at, ip_address, location, user_agent, evidence_hash",
      )
      .eq("booking_form_id", form.id)
      .eq("signer_role", "client")
      .maybeSingle()
    if (clientSignature && form.unsigned_pdf_path) {
      try {
        await writeClientSignedBookingPdf({
          snapshot,
          unsignedPath: String(form.unsigned_pdf_path),
          clientSignature,
        })
      } catch (pdfError) {
        console.warn("[booking-forms] could not write client-signed PDF:", pdfError)
      }
    }

    let ownerEmail: string | undefined
    if (form.deal_id) {
      const { data: deal } = await admin
        .from("deals")
        .select("owner_profile_id")
        .eq("id", form.deal_id)
        .maybeSingle()
      if (deal?.owner_profile_id) {
        const { data: owner } = await admin
          .from("profiles")
          .select("email")
          .eq("id", deal.owner_profile_id)
          .maybeSingle()
        ownerEmail = owner?.email ?? undefined
      }
    }

    const notification = await sendClientSignedBookingFormNotification({
      documentRef: String(form.document_ref),
      clientName: signerName,
      accountName: snapshot.billTo.accountName,
      eventName: snapshot.deal.title,
      dealsUrl: `${getServerSiteOrigin()}/admin/deals`,
      extraEmails: ownerEmail ? [ownerEmail] : [],
    })
    await admin
      .from("booking_forms")
      .update({
        last_error: notification.ok
          ? null
          : notification.error ?? notification.skipped ?? "Admin signature notification failed.",
      })
      .eq("id", form.id)

    revalidatePath("/admin")
    revalidatePath("/admin/deals")
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record signature."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

