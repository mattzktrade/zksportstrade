import { createAdminClient } from "@/lib/supabase/admin"

export const PACKAGE_BROCHURE_BUCKET = "package-brochures"
const MAX_BROCHURE_BYTES = 20 * 1024 * 1024

export function packageBrochureStoragePath(packageId: string, filename: string): string {
  const id = packageId.trim()
  const file = filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "brochure.pdf"
  return `${id}/${file}`
}

async function ensureBrochureBucket(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
): Promise<string | null> {
  const { data: buckets, error: listError } = await admin.storage.listBuckets()
  if (listError) return listError.message
  const exists = buckets?.some(
    (bucket) => bucket.id === PACKAGE_BROCHURE_BUCKET || bucket.name === PACKAGE_BROCHURE_BUCKET,
  )
  if (!exists) {
    const { error: createError } = await admin.storage.createBucket(PACKAGE_BROCHURE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_BROCHURE_BYTES,
      allowedMimeTypes: ["application/pdf"],
    })
    if (createError && !/already exists|duplicate/i.test(createError.message)) {
      return createError.message
    }
  }
  await admin.storage.updateBucket(PACKAGE_BROCHURE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BROCHURE_BYTES,
    allowedMimeTypes: ["application/pdf"],
  })
  return null
}

const LEGACY_BROCHURE_FILE = "brochure.pdf"
const PDF_CACHE_CONTROL = "0"

function brochureKeepNames(filename: string): Set<string> {
  const pretty = filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || LEGACY_BROCHURE_FILE
  return new Set([pretty, LEGACY_BROCHURE_FILE])
}

async function removePreviousBrochures(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  packageId: string,
  filename: string,
) {
  const folder = packageId.trim()
  const keep = brochureKeepNames(filename)
  const { data } = await admin.storage.from(PACKAGE_BROCHURE_BUCKET).list(folder)
  const stale = (data ?? [])
    .map((file) => file.name)
    .filter((name) => name.toLowerCase().endsWith(".pdf") && !keep.has(name))
    .map((name) => `${folder}/${name}`)
  if (stale.length === 0) return
  await admin.storage.from(PACKAGE_BROCHURE_BUCKET).remove(stale)
}

async function upsertPdf(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  path: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const { error } = await admin.storage.from(PACKAGE_BROCHURE_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: PDF_CACHE_CONTROL,
    upsert: true,
  })
  return error?.message ?? null
}

function storageUploadMessage(message: string): string {
  if (/maximum allowed size/i.test(message)) {
    return "This brochure file is too large to store. Use smaller JPEG gallery photos and try Recreate again."
  }
  return message
}

export async function uploadPackageBrochurePdf(
  packageId: string,
  bytes: Uint8Array,
  filename: string,
): Promise<{ url: string } | { error: string }> {
  const admin = createAdminClient()
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is required to store brochures." }

  const bucketError = await ensureBrochureBucket(admin)
  if (bucketError) return { error: bucketError }

  await removePreviousBrochures(admin, packageId, filename)
  if (bytes.byteLength > MAX_BROCHURE_BYTES) {
    return {
      error:
        "This brochure file is too large to store. Use smaller JPEG gallery photos and try Recreate again.",
    }
  }
  const prettyPath = packageBrochureStoragePath(packageId, filename)
  const legacyPath = packageBrochureStoragePath(packageId, LEGACY_BROCHURE_FILE)
  const prettyError = await upsertPdf(admin, prettyPath, bytes)
  if (prettyError) return { error: storageUploadMessage(prettyError) }
  if (legacyPath !== prettyPath) {
    await upsertPdf(admin, legacyPath, bytes)
  }

  const { data } = admin.storage.from(PACKAGE_BROCHURE_BUCKET).getPublicUrl(prettyPath)
  const url = data.publicUrl?.trim()
  if (!url) return { error: "Brochure uploaded but no public URL was returned." }
  const separator = url.includes("?") ? "&" : "?"
  return { url: `${url}${separator}v=${Date.now()}` }
}
