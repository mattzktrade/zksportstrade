"use server"

import { requireAdminAction } from "@/app/(admin)/actions"
import { CATALOG_IMAGE_BUCKET, CATALOG_IMAGE_MAX_BYTES } from "@/lib/catalog/catalog-image-upload"
import { createAdminClient } from "@/lib/supabase/admin"

const CATALOG_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}
const CATALOG_IMAGE_BUCKET_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export type CatalogImageUploadResult =
  | { ok: true; bucket: string; path: string; token: string; url: string; contentType: string }
  | { ok: false; message: string }

function extensionFor(fileName: string, contentType: string): string | null {
  const fromType = CATALOG_IMAGE_TYPES[contentType.trim().toLowerCase()]
  if (fromType) return fromType
  const match = fileName.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)
  if (!match) return null
  return match[1] === "jpeg" ? "jpg" : match[1]
}

function contentTypeFor(ext: string, fallback: string): string {
  if (ext === "jpg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  return fallback || "application/octet-stream"
}

function cleanFileStem(name: string): string {
  const withoutExt = name.replace(/\.[^.]+$/, "")
  const cleaned = withoutExt
    .trim()
    .toLowerCase()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
  return cleaned || "event-image"
}

async function ensureCatalogImageBucket(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
): Promise<string | null> {
  const { data: buckets, error: listError } = await admin.storage.listBuckets()
  if (listError) return listError.message
  if (buckets?.some((bucket) => bucket.id === CATALOG_IMAGE_BUCKET || bucket.name === CATALOG_IMAGE_BUCKET)) {
    return null
  }
  const { error: createError } = await admin.storage.createBucket(CATALOG_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: CATALOG_IMAGE_MAX_BYTES,
    allowedMimeTypes: CATALOG_IMAGE_BUCKET_MIME_TYPES,
  })
  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    return createError.message
  }
  return null
}

export async function prepareCatalogImageUpload(input: {
  fileName: string
  contentType: string
  size: number
}): Promise<CatalogImageUploadResult> {
  const gate = await requireAdminAction("inventory.manage")
  if (!gate.ok) return gate

  const fileName = typeof input?.fileName === "string" ? input.fileName : ""
  const contentType = typeof input?.contentType === "string" ? input.contentType : ""
  const size = typeof input?.size === "number" ? input.size : Number.NaN
  if (!fileName.trim() || !Number.isFinite(size) || size <= 0) {
    return { ok: false, message: "Choose an image file to upload." }
  }
  if (size > CATALOG_IMAGE_MAX_BYTES) {
    return { ok: false, message: "Image must be 8MB or smaller." }
  }
  const ext = extensionFor(fileName, contentType)
  if (!ext) {
    return { ok: false, message: "Upload a JPG, PNG, WebP, or GIF image." }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to upload event images." }
  }

  const bucketError = await ensureCatalogImageBucket(admin)
  if (bucketError) return { ok: false, message: bucketError }

  const filePath = `events/${Date.now()}-${crypto.randomUUID()}-${cleanFileStem(fileName)}.${ext}`
  const resolvedType = contentTypeFor(ext, contentType)
  const { data: signed, error: signedError } = await admin.storage
    .from(CATALOG_IMAGE_BUCKET)
    .createSignedUploadUrl(filePath)
  if (signedError || !signed?.token || !signed.path) {
    return { ok: false, message: signedError?.message ?? "Could not start the image upload." }
  }

  const { data } = admin.storage.from(CATALOG_IMAGE_BUCKET).getPublicUrl(signed.path)
  const url = data.publicUrl?.trim()
  if (!url) return { ok: false, message: "Image upload prepared but no public URL was returned." }

  return {
    ok: true,
    bucket: CATALOG_IMAGE_BUCKET,
    path: signed.path,
    token: signed.token,
    url,
    contentType: resolvedType,
  }
}
