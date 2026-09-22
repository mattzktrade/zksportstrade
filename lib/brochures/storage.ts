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

export type PackagePdfKind = "brochure" | "guest-guide"

const LEGACY_FILE: Record<PackagePdfKind, string> = {
  brochure: "brochure.pdf",
  "guest-guide": "guest-guide.pdf",
}
const PDF_CACHE_CONTROL = "0"

function sanitizePdfFilename(filename: string, fallback: string): string {
  return filename.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || fallback
}

function keepNames(filename: string, kind: PackagePdfKind): Set<string> {
  const pretty = sanitizePdfFilename(filename, LEGACY_FILE[kind])
  return new Set([pretty, LEGACY_FILE[kind]])
}

export function isPackagePdfKind(name: string, kind: PackagePdfKind): boolean {
  const n = name.toLowerCase()
  if (!n.endsWith(".pdf")) return false
  if (kind === "guest-guide") return n === "guest-guide.pdf" || n.endsWith("-guest-guide.pdf")
  return n === "brochure.pdf" || (n.endsWith("-brochure.pdf") && !n.includes("guest-guide"))
}

/** Only stale files of the same document kind are removed so sales PDFs and guest guides can share a folder. */
export function stalePackagePdfPaths(
  folder: string,
  names: string[],
  kind: PackagePdfKind,
  filename: string,
): string[] {
  const keep = keepNames(filename, kind)
  return names
    .filter((name) => isPackagePdfKind(name, kind) && !keep.has(name))
    .map((name) => `${folder}/${name}`)
}

async function removePreviousDocuments(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  packageId: string,
  filename: string,
  kind: PackagePdfKind,
) {
  const folder = packageId.trim()
  const { data } = await admin.storage.from(PACKAGE_BROCHURE_BUCKET).list(folder)
  const stale = stalePackagePdfPaths(
    folder,
    (data ?? []).map((file) => file.name),
    kind,
    filename,
  )
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

async function uploadPackagePdf(
  packageId: string,
  bytes: Uint8Array,
  filename: string,
  kind: PackagePdfKind,
): Promise<{ url: string } | { error: string }> {
  const admin = createAdminClient()
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is required to store brochures." }

  const bucketError = await ensureBrochureBucket(admin)
  if (bucketError) return { error: bucketError }

  await removePreviousDocuments(admin, packageId, filename, kind)
  if (bytes.byteLength > MAX_BROCHURE_BYTES) {
    return {
      error:
        kind === "guest-guide"
          ? "This guest guide file is too large to store. Use smaller JPEG gallery photos and try Recreate again."
          : "This brochure file is too large to store. Use smaller JPEG gallery photos and try Recreate again.",
    }
  }
  const prettyPath = packageBrochureStoragePath(packageId, filename)
  const legacyPath = packageBrochureStoragePath(packageId, LEGACY_FILE[kind])
  const prettyError = await upsertPdf(admin, prettyPath, bytes)
  if (prettyError) return { error: storageUploadMessage(prettyError) }
  if (legacyPath !== prettyPath) {
    await upsertPdf(admin, legacyPath, bytes)
  }

  const { data } = admin.storage.from(PACKAGE_BROCHURE_BUCKET).getPublicUrl(prettyPath)
  const url = data.publicUrl?.trim()
  if (!url) {
    return {
      error:
        kind === "guest-guide"
          ? "Guest guide uploaded but no public URL was returned."
          : "Brochure uploaded but no public URL was returned.",
    }
  }
  const separator = url.includes("?") ? "&" : "?"
  return { url: `${url}${separator}v=${Date.now()}` }
}

export async function uploadPackageBrochurePdf(
  packageId: string,
  bytes: Uint8Array,
  filename: string,
): Promise<{ url: string } | { error: string }> {
  return uploadPackagePdf(packageId, bytes, filename, "brochure")
}

export async function uploadPackageGuestGuidePdf(
  packageId: string,
  bytes: Uint8Array,
  filename: string,
): Promise<{ url: string } | { error: string }> {
  return uploadPackagePdf(packageId, bytes, filename, "guest-guide")
}
