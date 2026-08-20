import { generateBookingFormPdf, type PdfSignature } from "@/lib/booking-forms/pdf"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import { downloadBookingDocument, uploadBookingDocument } from "@/lib/booking-forms/storage"

export type StoredBookingSignature = {
  signer_role: string
  signer_name: string
  signer_email: string
  signature_path: string
  signed_at: string
  ip_address: string | null
  location: string | null
  user_agent: string | null
  evidence_hash: string
}

export async function storedSignatureToPdf(
  row: StoredBookingSignature,
): Promise<PdfSignature> {
  const role = row.signer_role === "zk_admin" ? "zk_admin" : "client"
  return {
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
  }
}

export async function writeClientSignedBookingPdf(input: {
  snapshot: BookingFormSnapshot
  unsignedPath: string
  clientSignature: StoredBookingSignature
}): Promise<void> {
  const client = await storedSignatureToPdf(input.clientSignature)
  const pdf = await generateBookingFormPdf(input.snapshot, { client })
  await uploadBookingDocument(input.unsignedPath, pdf, "application/pdf", true)
}
