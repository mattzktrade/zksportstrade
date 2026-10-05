import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { getRequestEvidence } from "@/lib/booking-forms/request-evidence"
import { parseSignaturePng } from "@/lib/booking-forms/storage"
import {
  CONTRACT_SIGNATURE_CONSENT,
  contractLinkExpired,
  normalizeContractDraft,
} from "@/lib/contracts/content"
import { contractContentHash, sha256, stableJson } from "@/lib/contracts/hash"
import { generateInclusionContractPdf } from "@/lib/contracts/pdf"
import { uploadContractDocument } from "@/lib/contracts/storage"
import { sendInclusionContractSignedEmail } from "@/lib/email/send-inclusion-contract"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers)
    if (!checkRateLimit(`inclusion-contract:sign:${ip}`, 20, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const token = String(body.token ?? "").trim()
    const signerName = String(body.signerName ?? "").trim()
    const signerPosition = String(body.signerPosition ?? "").trim()
    const contentHash = String(body.contentHash ?? "").trim()
    const signatureDataUrl = String(body.signatureDataUrl ?? "")
    if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
      return NextResponse.json({ error: "This signing link is not valid." }, { status: 404 })
    }
    if (signerName.length < 2 || signerName.length > 160) {
      return NextResponse.json({ error: "Enter your full name." }, { status: 400 })
    }
    if (signerPosition.length < 2 || signerPosition.length > 120) {
      return NextResponse.json({ error: "Enter your position." }, { status: 400 })
    }
    if (body.consent !== true) {
      return NextResponse.json({ error: "Please confirm you accept these inclusions." }, { status: 400 })
    }

    const admin = createAdminClient()
    if (!admin) return NextResponse.json({ error: "Signing is not available right now." }, { status: 503 })

    const { data: form, error } = await admin
      .from("inclusion_contracts")
      .select(
        "id, document_ref, title, status, company_name, client_name, client_email, content, content_hash, client_token_expires_at, created_at",
      )
      .eq("client_token_hash", sha256(token))
      .maybeSingle()
    if (error || !form) {
      return NextResponse.json({ error: "This signing link is not valid." }, { status: 404 })
    }
    if (form.status === "signed") return NextResponse.json({ ok: true, alreadySigned: true })
    if (!["sent", "viewed"].includes(String(form.status))) {
      return NextResponse.json({ error: "This contract can no longer be signed." }, { status: 409 })
    }
    if (contractLinkExpired(String(form.status), form.client_token_expires_at ? String(form.client_token_expires_at) : null)) {
      return NextResponse.json({ error: "This signing link has expired. Ask ZK for a new one." }, { status: 410 })
    }
    const draft = normalizeContractDraft({
      title: String(form.title),
      companyName: String(form.company_name ?? ""),
      clientName: String(form.client_name ?? ""),
      clientEmail: String(form.client_email ?? ""),
      content: form.content,
    })
    if (contentHash !== String(form.content_hash) || contractContentHash(draft) !== String(form.content_hash)) {
      return NextResponse.json(
        { error: "This contract was updated. Refresh the page, review it again, then sign." },
        { status: 409 },
      )
    }
    const signatureBytes = parseSignaturePng(signatureDataUrl)
    const signatureHash = sha256(signatureBytes)
    const signedAt = new Date().toISOString()
    const evidenceHash = sha256(
      stableJson({
        contractId: form.id,
        signerName,
        signerPosition,
        signatureHash,
        contentHash,
      }),
    )
    const signaturePath = `contracts/${form.document_ref}/signature.png`
    const pdfPath = `contracts/${form.document_ref}/signed.pdf`
    await uploadContractDocument(signaturePath, signatureBytes, "image/png")
    const pdf = await generateInclusionContractPdf({
      documentRef: String(form.document_ref),
      draft,
      issuedAt: form.created_at ? String(form.created_at) : signedAt,
      signature: { name: signerName, position: signerPosition, signedAt, pngBytes: signatureBytes },
    })
    await uploadContractDocument(pdfPath, pdf, "application/pdf")

    const { data: updated, error: updateError } = await admin
      .from("inclusion_contracts")
      .update({
        status: "signed",
        signed_at: signedAt,
        signer_name: signerName,
        signer_position: signerPosition,
        signer_email: draft.clientEmail,
        signed_pdf_path: pdfPath,
        last_error: null,
        updated_at: signedAt,
      })
      .eq("id", form.id)
      .in("status", ["sent", "viewed"])
      .select("id")
    if (updateError) return NextResponse.json({ error: "Could not record the signature." }, { status: 400 })
    if (!updated?.length) return NextResponse.json({ ok: true, alreadySigned: true })

    const evidence = getRequestEvidence(request.headers)
    const { error: signatureError } = await admin.from("inclusion_contract_signatures").insert({
      contract_id: form.id,
      signer_name: signerName,
      signer_position: signerPosition,
      signer_email: draft.clientEmail,
      signature_path: signaturePath,
      signature_sha256: signatureHash,
      evidence_hash: evidenceHash,
      consent_text: CONTRACT_SIGNATURE_CONSENT,
      ip_address: evidence.ipAddress,
      location: evidence.location,
      user_agent: evidence.userAgent,
      signed_at: signedAt,
    })
    if (signatureError && !/duplicate|unique/i.test(signatureError.message)) {
      console.warn("[contracts] signature row:", signatureError.message)
    }
    await admin.from("inclusion_contract_events").insert({
      contract_id: form.id,
      event_type: "signed",
      actor_email: draft.clientEmail,
      metadata: { signerName, signerPosition },
    })

    const email = await sendInclusionContractSignedEmail({
      recipientEmail: draft.clientEmail,
      recipientName: signerName,
      companyName: draft.companyName,
      documentRef: String(form.document_ref),
      title: draft.title,
      pdf,
    })
    if (!email.ok) {
      await admin
        .from("inclusion_contracts")
        .update({ last_error: email.error ?? email.skipped ?? "Signed copy email was not sent." })
        .eq("id", form.id)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the signature."
    const safe = /signature|png|empty|large|invalid/i.test(message) ? message : "Could not record the signature."
    return NextResponse.json({ error: safe }, { status: 400 })
  }
}
