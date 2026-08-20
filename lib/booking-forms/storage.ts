import { createAdminClient } from "@/lib/supabase/admin"

export const BOOKING_DOCUMENT_BUCKET = "booking-form-documents"
const MAX_SIGNATURE_BYTES = 500 * 1024
const MAX_SIGNATURE_WIDTH = 2000
const MAX_SIGNATURE_HEIGHT = 1000

export function parseSignaturePng(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error("Signature must be a PNG image.")
  const bytes = Buffer.from(match[1], "base64")
  if (bytes.length < 24 || bytes.length > MAX_SIGNATURE_BYTES) {
    throw new Error("Signature image is empty or too large.")
  }
  const pngMagic = "89504e470d0a1a0a"
  if (bytes.subarray(0, 8).toString("hex") !== pngMagic) {
    throw new Error("Signature image is invalid.")
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (
    width < 20 ||
    height < 10 ||
    width > MAX_SIGNATURE_WIDTH ||
    height > MAX_SIGNATURE_HEIGHT
  ) {
    throw new Error("Signature image dimensions are invalid.")
  }
  return bytes
}

export async function uploadBookingDocument(
  path: string,
  bytes: Uint8Array,
  contentType: "application/pdf" | "image/png",
  upsert = false,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { error } = await admin.storage
    .from(BOOKING_DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType, upsert })
  if (error) throw new Error(error.message)
}

export async function downloadBookingDocument(path: string): Promise<Uint8Array> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin.storage.from(BOOKING_DOCUMENT_BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? "Document not found.")
  return new Uint8Array(await data.arrayBuffer())
}

export async function createBookingDocumentUrl(path: string, expiresIn = 300): Promise<string> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin.storage
    .from(BOOKING_DOCUMENT_BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not create download URL.")
  return data.signedUrl
}

