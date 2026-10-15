import { createAdminClient } from "@/lib/supabase/admin"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { markEnquiryClientReplied } from "@/lib/crm/enquiry-replied"
import { isOutreachStopKeyword } from "@/lib/integrations/marketing-leads/outreach-labels"
import { findActiveOutreachByEmail } from "@/lib/integrations/marketing-leads/outreach-store"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { parseAssistantEmailEvent } from "@/lib/assistant/email-parse"
import { ingestAssistantEvent } from "@/lib/assistant/ingest"
import { matchContactsByEmail, pickIdentityMatch } from "@/lib/assistant/identity"
import { findConversationByEmail } from "@/lib/assistant/store"

export {
  getInboundEmailWebhookSecret,
  INBOUND_EMAIL_WEBHOOK_PATH,
  INBOUND_EMAIL_WEBHOOK_URL,
  isInboundEmailWebhookConfigured,
} from "@/lib/assistant/email-inbound-config"

export async function handleInboundSalesEmail(body: unknown): Promise<{
  ok: true
  ingested: boolean
  ignored?: string
}> {
  const event = parseAssistantEmailEvent(body)
  if (!event?.fromEmail) {
    return { ok: true, ingested: false, ignored: "not_a_client_reply" }
  }

  const admin = createAdminClient()
  if (!admin) return { ok: true, ingested: false, ignored: "no_admin" }

  const [conversation, enrollment] = await Promise.all([
    findConversationByEmail(admin, event.fromEmail),
    findActiveOutreachByEmail(admin, event.fromEmail),
  ])
  if (!conversation && !enrollment) {
    const contacts = await matchContactsByEmail(admin, event.fromEmail)
    if (pickIdentityMatch(contacts).status !== "unique") {
      return { ok: true, ingested: false, ignored: "unknown_sender" }
    }
  }

  if (enrollment) {
    const reason = isOutreachStopKeyword(event.body) ? "stop_keyword" : "replied"
    await stopMarketingOutreach(enrollment.deal_id, reason)
    if (reason === "replied") {
      await markEnquiryClientReplied(admin, enrollment.deal_id)
      await admin
        .from("deals")
        .update({
          enquiry_stage: "responded",
          next_action: suggestedEnquiryAction("responded"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", enrollment.deal_id)
        .in("enquiry_stage", ["new", "contacted"])
    }
  }

  try {
    await ingestAssistantEvent(event)
  } catch (error) {
    console.error("[assistant-email]", error instanceof Error ? error.message : "Ingest failed.")
    return { ok: true, ingested: false, ignored: "ingest_failed" }
  }
  return { ok: true, ingested: true }
}
