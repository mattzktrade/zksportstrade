import Link from "next/link"
import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { AssistantConversationClient } from "../conversation-client"

export const dynamic = "force-dynamic"

export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  await requireAdmin()
  const { conversationId } = await params
  const supabase = await createClient()
  const { data: conversation } = await supabase.from("assistant_conversations").select("*").eq("id", conversationId).maybeSingle()
  if (!conversation) notFound()
  const [{ data: messages }, { data: drafts }, { data: deal }] = await Promise.all([
    supabase
      .from("assistant_messages")
      .select("id, direction, sent_by, body, media_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("assistant_drafts")
      .select("id, body, status, intent")
      .eq("conversation_id", conversationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1),
    conversation.deal_id
      ? supabase.from("deals").select("id, reference, stage, enquiry_stage").eq("id", conversation.deal_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const draft = drafts?.[0] ?? null

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title={String(conversation.display_name || conversation.email || conversation.phone_digits || "Conversation")}
        description={`${conversation.channel} · ${String(conversation.status).replaceAll("_", " ")}`}
        action={
          <Link href="/admin/assistant" className="text-xs font-medium text-primary">
            Back to inbox
          </Link>
        }
      />
      <AssistantConversationClient
        conversationId={conversationId}
        status={String(conversation.status)}
        dealId={conversation.deal_id ? String(conversation.deal_id) : null}
        dealReference={deal?.reference ? String(deal.reference) : null}
        messages={(messages ?? []).map((row) => ({
          id: String(row.id),
          direction: String(row.direction),
          sentBy: String(row.sent_by),
          body: String(row.body ?? ""),
          mediaType: row.media_type ? String(row.media_type) : null,
          createdAt: String(row.created_at),
        }))}
        draft={draft ? { id: String(draft.id), body: String(draft.body), intent: String(draft.intent) } : null}
      />
    </div>
  )
}
