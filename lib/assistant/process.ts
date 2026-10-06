import { createAdminClient } from "@/lib/supabase/admin"
import { dueConversations } from "@/lib/assistant/store"
import { runAssistantConversation } from "@/lib/assistant/run"

export async function processAssistantInbox(limit = 10): Promise<{
  processed: number
  sent: number
  drafted: number
  escalated: number
  failed: number
}> {
  const admin = createAdminClient()
  if (!admin) {
    return { processed: 0, sent: 0, drafted: 0, escalated: 0, failed: 0 }
  }
  const due = await dueConversations(admin, limit)
  let sent = 0
  let drafted = 0
  let escalated = 0
  let failed = 0
  for (const conversation of due) {
    try {
      const result = await runAssistantConversation(admin, conversation.id)
      if (result.decision === "sent") sent += 1
      else if (result.decision === "drafted") drafted += 1
      else if (result.decision === "skipped") drafted += 0
      else escalated += 1
    } catch (error) {
      failed += 1
      console.error("[assistant]", error instanceof Error ? error.message : "Assistant run failed.")
      await admin
        .from("assistant_conversations")
        .update({
          status: "needs_review",
          last_error: error instanceof Error ? error.message : "Assistant run failed.",
          run_after_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
    }
  }
  return { processed: due.length, sent, drafted, escalated, failed }
}
