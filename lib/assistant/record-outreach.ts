import { firstNameFromFullName } from "@/lib/integrations/marketing-leads/outreach-render"
import type { MarketingOutreachChannel, MarketingOutreachEnrollment } from "@/lib/integrations/marketing-leads/outreach-types"
import {
  findConversationByEmail,
  findConversationByPhone,
  insertConversation,
  insertMessage,
  updateConversation,
} from "@/lib/assistant/store"

type Admin = Parameters<typeof insertConversation>[0]

export async function recordOutreachOutbound(
  admin: Admin,
  input: {
    enrollment: MarketingOutreachEnrollment
    channel: MarketingOutreachChannel
    body: string
    subject?: string | null
    providerMessageId?: string | null
    stage: number
  },
): Promise<void> {
  const phone = (input.enrollment.phone_digits || input.enrollment.phone || "").replace(/\D/g, "")
  const email = input.enrollment.email?.trim().toLowerCase() || null
  if (input.channel === "whatsapp" && phone.length < 8) return
  if (input.channel === "email" && !email) return

  const existing =
    input.channel === "whatsapp" ? await findConversationByPhone(admin, phone) : await findConversationByEmail(admin, email || "")

  const displayName =
    input.enrollment.full_name?.trim() ||
    firstNameFromFullName(input.enrollment.full_name || "") ||
    email ||
    phone

  const conversation =
    existing ??
    (await insertConversation(admin, {
      channel: input.channel,
      status: "human_takeover",
      identityStatus: "unique",
      phoneDigits: input.channel === "whatsapp" ? phone : phone || null,
      email,
      displayName,
      accountId: input.enrollment.account_id,
      contactId: input.enrollment.contact_id,
      dealId: input.enrollment.deal_id,
    }))

  const now = new Date().toISOString()
  const body =
    input.channel === "email" && input.subject?.trim()
      ? `${input.subject.trim()}\n\n${input.body}`.trim()
      : input.body
  await insertMessage(admin, {
    conversationId: conversation.id,
    direction: "outbound",
    sentBy: "staff",
    channel: input.channel,
    body,
    providerMessageId: input.providerMessageId,
    processedAt: now,
    raw: { source: "marketing_outreach", stage: input.stage },
  })

  const patch: Record<string, unknown> = {
    last_outbound_at: now,
    run_after_at: null,
    last_error: null,
    display_name: displayName,
  }
  if (!conversation.dealId && input.enrollment.deal_id) patch.deal_id = input.enrollment.deal_id
  if (!conversation.accountId && input.enrollment.account_id) patch.account_id = input.enrollment.account_id
  if (!conversation.contactId && input.enrollment.contact_id) patch.contact_id = input.enrollment.contact_id
  await updateConversation(admin, conversation.id, patch)
}
