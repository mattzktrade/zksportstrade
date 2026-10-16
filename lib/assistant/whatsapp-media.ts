import { getWhatsAppCloudConfig } from "@/lib/integrations/marketing-leads/outreach-config"
import { createAdminClient } from "@/lib/supabase/admin"

export const ASSISTANT_WHATSAPP_MEDIA_BUCKET = "assistant-whatsapp-media"
export const WHATSAPP_MEDIA_KINDS = ["image", "video", "document", "audio", "sticker"] as const
export type WhatsAppMediaKind = (typeof WHATSAPP_MEDIA_KINDS)[number]

export type WhatsAppMediaRef = {
  mediaId: string
  kind: WhatsAppMediaKind
  mimeType: string | null
  filename: string | null
  caption: string | null
  storedPath: string | null
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function isWhatsAppMediaKind(value: string | null | undefined): value is WhatsAppMediaKind {
  return Boolean(value && (WHATSAPP_MEDIA_KINDS as readonly string[]).includes(value))
}

export function whatsAppMediaLabel(kind: string | null | undefined, filename?: string | null): string {
  if (filename?.trim()) return filename.trim()
  if (kind === "image") return "Photo"
  if (kind === "video") return "Video"
  if (kind === "audio") return "Voice note"
  if (kind === "sticker") return "Sticker"
  if (kind === "document") return "Document"
  return "File"
}

export function whatsAppMediaFromRaw(raw: unknown, mediaType?: string | null): WhatsAppMediaRef | null {
  const message = asRecord(raw)
  if (!message) return null
  const type = (typeof message.type === "string" && message.type) || mediaType || ""
  if (!isWhatsAppMediaKind(type)) return null
  const media = asRecord(message[type])
  if (!media) return null
  const mediaId = typeof media.id === "string" ? media.id.trim() : ""
  if (!mediaId) return null
  const stored =
    (typeof message.zk_stored_path === "string" && message.zk_stored_path.trim()) ||
    (typeof media.zk_stored_path === "string" && media.zk_stored_path.trim()) ||
    null
  return {
    mediaId,
    kind: type,
    mimeType: typeof media.mime_type === "string" ? media.mime_type : null,
    filename: typeof media.filename === "string" ? media.filename : null,
    caption: typeof media.caption === "string" ? media.caption : null,
    storedPath: stored,
  }
}

export function inboxMessageMediaHref(messageId: string): string {
  return `/api/admin/assistant/messages/${messageId}/media`
}

function safeFilename(value: string | null | undefined, kind: WhatsAppMediaKind, mimeType: string | null): string {
  const raw = (value || "").replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").trim()
  if (raw && raw !== "." && !raw.includes("..")) return raw.slice(0, 120)
  const ext =
    mimeType === "application/pdf"
      ? "pdf"
      : mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : mimeType === "video/mp4"
              ? "mp4"
              : mimeType === "audio/ogg"
                ? "ogg"
                : kind === "document"
                  ? "bin"
                  : kind
  return `${kind}.${ext}`
}

export function mediaShouldDisplayInline(kind: WhatsAppMediaKind, mimeType: string | null): boolean {
  if (kind === "image" || kind === "sticker" || kind === "video" || kind === "audio") return true
  return Boolean(mimeType && (mimeType === "application/pdf" || mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")))
}

async function ensureMediaBucket(admin: NonNullable<ReturnType<typeof createAdminClient>>): Promise<void> {
  const { error } = await admin.storage.createBucket(ASSISTANT_WHATSAPP_MEDIA_BUCKET, {
    public: false,
    fileSizeLimit: MAX_MEDIA_BYTES,
  })
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.error("[assistant-whatsapp] media bucket", error.message)
  }
}

async function downloadWhatsAppCloudMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const config = getWhatsAppCloudConfig()
  if (!config) return null
  const metaResponse = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!metaResponse.ok) return null
  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string }
  if (!meta.url) return null
  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.token}` },
  })
  if (!fileResponse.ok) return null
  const bytes = new Uint8Array(await fileResponse.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return null
  return {
    bytes,
    mimeType: typeof meta.mime_type === "string" ? meta.mime_type : "application/octet-stream",
  }
}

export async function persistWhatsAppInboundMedia(input: {
  conversationId: string
  messageId: string
  raw: Record<string, unknown>
  mediaType?: string | null
  bytes?: Uint8Array
  mimeType?: string
}): Promise<string | null> {
  const ref = whatsAppMediaFromRaw(input.raw, input.mediaType)
  if (!ref || ref.storedPath) return ref?.storedPath ?? null
  const admin = createAdminClient()
  if (!admin) return null
  const downloaded =
    input.bytes && input.bytes.length > 0
      ? { bytes: input.bytes, mimeType: input.mimeType || ref.mimeType || "application/octet-stream" }
      : await downloadWhatsAppCloudMedia(ref.mediaId)
  if (!downloaded) return null
  await ensureMediaBucket(admin)
  const filename = safeFilename(ref.filename, ref.kind, downloaded.mimeType)
  const path = `${input.conversationId}/${input.messageId}/${filename}`
  const { error } = await admin.storage.from(ASSISTANT_WHATSAPP_MEDIA_BUCKET).upload(path, downloaded.bytes, {
    contentType: downloaded.mimeType,
    upsert: true,
  })
  if (error) {
    console.error("[assistant-whatsapp] media store", error.message)
    return null
  }
  await admin
    .from("assistant_messages")
    .update({ raw: { ...input.raw, zk_stored_path: path, zk_stored_mime: downloaded.mimeType } })
    .eq("id", input.messageId)
  return path
}

export async function readWhatsAppInboxMedia(input: {
  raw: unknown
  mediaType?: string | null
}): Promise<{ bytes: Uint8Array; mimeType: string; filename: string; inline: boolean } | null> {
  const ref = whatsAppMediaFromRaw(input.raw, input.mediaType)
  if (!ref) return null
  const admin = createAdminClient()
  if (admin && ref.storedPath) {
    const { data, error } = await admin.storage.from(ASSISTANT_WHATSAPP_MEDIA_BUCKET).download(ref.storedPath)
    if (!error && data) {
      const mime =
        (asRecord(input.raw)?.zk_stored_mime as string | undefined) ||
        ref.mimeType ||
        data.type ||
        "application/octet-stream"
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        mimeType: mime,
        filename: safeFilename(ref.filename, ref.kind, mime),
        inline: mediaShouldDisplayInline(ref.kind, mime),
      }
    }
  }
  const downloaded = await downloadWhatsAppCloudMedia(ref.mediaId)
  if (!downloaded) return null
  return {
    bytes: downloaded.bytes,
    mimeType: downloaded.mimeType,
    filename: safeFilename(ref.filename, ref.kind, downloaded.mimeType),
    inline: mediaShouldDisplayInline(ref.kind, downloaded.mimeType),
  }
}
