import { canSendWhatsAppReply, type InboxThread } from "@/lib/assistant/inbox"
import { getConversation, latestPendingDraft } from "@/lib/assistant/store"
import {
  inboxMessageMediaHref,
  isWhatsAppMediaKind,
  whatsAppMediaFromRaw,
  whatsAppMediaLabel,
} from "@/lib/assistant/whatsapp-media"
import { createAdminClient } from "@/lib/supabase/admin"

export async function loadInboxThreadById(conversationId: string): Promise<InboxThread | null> {
  const id = conversationId.trim()
  if (!id) return null
  const admin = createAdminClient()
  if (!admin) return null
  const conversation = await getConversation(admin, id)
  if (!conversation) return null
  const [messagesRes, draft, deal] = await Promise.all([
    admin
      .from("assistant_messages")
      .select("id, direction, sent_by, channel, body, media_type, created_at, raw")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
    latestPendingDraft(admin, id),
    conversation.dealId
      ? admin.from("deals").select("reference").eq("id", conversation.dealId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return {
    conversationId: conversation.id,
    status: conversation.status,
    channel: conversation.channel,
    canSendWhatsApp: canSendWhatsAppReply(conversation.lastClientMessageAt),
    displayName: conversation.displayName || conversation.email || conversation.phoneDigits || "Client",
    email: conversation.email,
    phone: conversation.phoneDigits,
    dealId: conversation.dealId,
    dealReference: deal.data?.reference ? String(deal.data.reference) : null,
    outreachLabel: null,
    messages: (messagesRes.data ?? []).map((row) => {
      const mediaType = row.media_type == null ? null : String(row.media_type)
      const media = whatsAppMediaFromRaw(row.raw, mediaType)
      const hasMedia = Boolean(media) || isWhatsAppMediaKind(mediaType)
      return {
        id: String(row.id),
        direction: String(row.direction),
        sentBy: String(row.sent_by),
        channel: String(row.channel || conversation.channel),
        body: String(row.body ?? ""),
        mediaType,
        mediaFilename: media?.filename ?? (hasMedia ? whatsAppMediaLabel(mediaType) : null),
        hasMedia,
        createdAt: String(row.created_at),
        mediaHref: hasMedia ? inboxMessageMediaHref(String(row.id)) : null,
      }
    }),
    draft: draft ? { id: draft.id, body: draft.body, intent: draft.intent } : null,
  }
}
