import { createAdminClient } from "@/lib/supabase/admin"

export const PACKAGE_BROCHURE_BUCKET = "package-brochures"
const MAX_BROCHURE_BYTES = 12 * 1024 * 1024

export function packageBrochureStoragePath(packageId: string): string {
  return `${packageId.trim()}/brochure.pdf`
}

async function ensureBrochureBucket(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
): Promise<string | null> {
  const { data: buckets, error: listError } = await admin.storage.listBuckets()
  if (listError) return listError.message
  if (buckets?.some((bucket) => bucket.id === PACKAGE_BROCHURE_BUCKET || bucket.name === PACKAGE_BROCHURE_BUCKET)) {
    return null
  }
  const { error: createError } = await admin.storage.createBucket(PACKAGE_BROCHURE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BROCHURE_BYTES,
    allowedMimeTypes: ["application/pdf"],
  })
  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    return createError.message
  }
  return null
}

export async function uploadPackageBrochurePdf(
  packageId: string,
  bytes: Uint8Array,
): Promise<{ url: string } | { error: string }> {
  const admin = createAdminClient()
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is required to store brochures." }

  const bucketError = await ensureBrochureBucket(admin)
  if (bucketError) return { error: bucketError }

  const path = packageBrochureStoragePath(packageId)
  const { error: uploadError } = await admin.storage.from(PACKAGE_BROCHURE_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: true,
  })
  if (uploadError) return { error: uploadError.message }

  const { data } = admin.storage.from(PACKAGE_BROCHURE_BUCKET).getPublicUrl(path)
  const url = data.publicUrl?.trim()
  if (!url) return { error: "Brochure uploaded but no public URL was returned." }
  const separator = url.includes("?") ? "&" : "?"
  return { url: `${url}${separator}v=${Date.now()}` }
}
