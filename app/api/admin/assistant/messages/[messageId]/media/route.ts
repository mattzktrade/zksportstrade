import { NextResponse } from "next/server"
import { isCmsStaff } from "@/lib/auth/permissions"
import {
  persistWhatsAppInboundMedia,
  readWhatsAppInboxMedia,
  whatsAppMediaFromRaw,
} from "@/lib/assistant/whatsapp-media"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPortalProfile } from "@/lib/supabase/profile"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const profile = await getPortalProfile()
  if (!profile || !isCmsStaff(profile)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 })
  const { messageId } = await context.params
  const { data: message, error } = await admin
    .from("assistant_messages")
    .select("id, conversation_id, media_type, raw")
    .eq("id", messageId)
    .maybeSingle()
  if (error || !message) return NextResponse.json({ error: "Message not found." }, { status: 404 })
  const mediaType = message.media_type ? String(message.media_type) : null
  const ref = whatsAppMediaFromRaw(message.raw, mediaType)
  if (!ref) return NextResponse.json({ error: "This message has no file." }, { status: 404 })
  try {
    const media = await readWhatsAppInboxMedia({
      raw: message.raw,
      mediaType,
    })
    if (!media) {
      return NextResponse.json(
        { error: "This file is no longer available from WhatsApp." },
        { status: 410 },
      )
    }
    if (!ref.storedPath && message.conversation_id && message.raw && typeof message.raw === "object") {
      void persistWhatsAppInboundMedia({
        conversationId: String(message.conversation_id),
        messageId,
        raw: message.raw as Record<string, unknown>,
        mediaType,
        bytes: media.bytes,
        mimeType: media.mimeType,
      }).catch(() => undefined)
    }
    const disposition = media.inline ? "inline" : "attachment"
    return new NextResponse(Buffer.from(media.bytes), {
      headers: {
        "Content-Type": media.mimeType,
        "Content-Disposition": `${disposition}; filename="${media.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open this file." },
      { status: 500 },
    )
  }
}
