import { createAdminClient } from "@/lib/supabase/admin"

export const CONTRACT_DOCUMENT_BUCKET = "inclusion-contracts"

export async function uploadContractDocument(
  path: string,
  bytes: Uint8Array,
  contentType: "application/pdf" | "image/png",
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { error } = await admin.storage
    .from(CONTRACT_DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType, upsert: true })
  if (error) throw new Error(error.message)
}

export async function downloadContractDocument(path: string): Promise<Uint8Array> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin.storage.from(CONTRACT_DOCUMENT_BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? "Document not found.")
  return new Uint8Array(await data.arrayBuffer())
}

export async function createContractDocumentUrl(path: string, expiresIn = 300): Promise<string> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data, error } = await admin.storage
    .from(CONTRACT_DOCUMENT_BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not create download URL.")
  return data.signedUrl
}
