import { isOpenEnquiry, suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { markEnquiryClientReplied } from "@/lib/crm/enquiry-replied"
import {
  findActiveOutreachByEmail,
  findOutreachEnrollmentByPhone,
} from "@/lib/integrations/marketing-leads/outreach-store"
import { sendAssistantStaffAlert } from "@/lib/assistant/notifications"
import {
  assistantWillAutoReplyFromSettings,
  inWhatsAppReplyNotifyBurst,
  whatsAppReplyNoticeDue,
  whatsAppReplyPreview,
} from "@/lib/assistant/reply-needed"
import { createAdminClient } from "@/lib/supabase/admin"
import { classifyClientMessage, isLowContentMessage } from "@/lib/assistant/classify"
import { displayNameForUnknownWhatsApp } from "@/lib/assistant/phone"
import { resolveAssistantIdentity } from "@/lib/assistant/identity"
import { effectiveKillSwitch, llmIsConfigured, loadAssistantSettings } from "@/lib/assistant/settings"
import {
  findConversationByDeal,
  findConversationByEmail,
  findConversationByPhone,
  getConversation,
  insertConversation,
  insertMessage,
  updateConversation,
} from "@/lib/assistant/store"
import type { InboundAssistantEvent } from "@/lib/assistant/whatsapp-parse"
import { isWhatsAppMediaKind, persistWhatsAppInboundMedia } from "@/lib/assistant/whatsapp-media"
import type { AssistantChannel, AssistantConversation } from "@/lib/assistant/types"

function storeWhatsAppMedia(
  conversationId: string,
  messageId: string,
  event: InboundAssistantEvent,
  duplicate: boolean,
) {
  if (duplicate || event.channel !== "whatsapp" || !isWhatsAppMediaKind(event.mediaType)) return
  void persistWhatsAppInboundMedia({
    conversationId,
    messageId,
    raw: event.raw,
    mediaType: event.mediaType,
  }).catch((error) => {
    console.error("[assistant-whatsapp] media persist", error instanceof Error ? error.message : error)
  })
}

const OPEN_STAGES = ["draft", "sourcing", "proposal"]

async function findOpenEnquiry(admin: NonNullable<ReturnType<typeof createAdminClient>>, accountId: string) {
  const { data } = await admin
    .from("deals")
    .select("id, stage, enquiry_stage")
    .eq("account_id", accountId)
    .in("stage", OPEN_STAGES)
    .order("updated_at", { ascending: false })
    .limit(10)
  const open = (data ?? []).find((row) => isOpenEnquiry({ stage: String(row.stage), enquiry_stage: row.enquiry_stage }))
  return open?.id ? String(open.id) : null
}

async function createEnquiry(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: { accountId: string; contactId: string; source: "whatsapp" | "email"; notes: string },
): Promise<string> {
  const { data, error } = await admin
    .from("deals")
    .insert({
      reference: "DL0000",
      account_id: input.accountId,
      primary_contact_id: input.contactId,
      source: input.source,
      stage: "draft",
      enquiry_stage: "new",
      enquiry_temperature: "warm",
      currency: "USD",
      total_amount: 0,
      notes: input.notes,
      next_action: suggestedEnquiryAction("new"),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(error?.message || "Could not create enquiry.")
  await admin.from("deal_activities").insert({
    deal_id: data.id,
    action: "created",
    summary: `Enquiry opened from ${input.source === "whatsapp" ? "WhatsApp" : "email"} by the sales assistant.`,
    metadata: { source: input.source },
  })
  return String(data.id)
}

export async function ingestAssistantEvent(event: InboundAssistantEvent): Promise<{
  conversationId: string
  messageId: string
  duplicate: boolean
  takeover: boolean
} | null> {
  const admin = createAdminClient()
  if (!admin) return null

  if (event.sentBy === "staff") {
    const existing =
      (event.fromDigits ? await findConversationByPhone(admin, event.fromDigits) : null) ||
      (event.fromEmail ? await findConversationByEmail(admin, event.fromEmail) : null)
    if (!existing) return null
    const inserted = await insertMessage(admin, {
      conversationId: existing.id,
      direction: "outbound",
      sentBy: "staff",
      channel: event.channel,
      body: event.body || "(sent from phone)",
      mediaType: event.mediaType,
      providerMessageId: event.providerMessageId,
      raw: event.raw,
      processedAt: new Date().toISOString(),
    })
    if (!inserted.duplicate) {
      storeWhatsAppMedia(existing.id, inserted.id, event, inserted.duplicate)
      await updateConversation(admin, existing.id, {
        status: "human_takeover",
        last_outbound_at: new Date().toISOString(),
        run_after_at: null,
      })
    }
    return { conversationId: existing.id, messageId: inserted.id, duplicate: inserted.duplicate, takeover: true }
  }

  const settings = await loadAssistantSettings(admin)
  const now = new Date()
  const runAfter = new Date(now.getTime() + settings.debounceSeconds * 1000).toISOString()

  const enrollment = event.fromDigits
    ? await findOutreachEnrollmentByPhone(admin, event.fromDigits)
    : event.fromEmail
      ? await findActiveOutreachByEmail(admin, event.fromEmail)
      : null

  let conversation: AssistantConversation | null =
    (event.fromDigits ? await findConversationByPhone(admin, event.fromDigits) : null) ||
    (event.fromEmail ? await findConversationByEmail(admin, event.fromEmail) : null) ||
    (enrollment ? await findConversationByDeal(admin, enrollment.deal_id) : null)
  const previousLastClientAt = conversation?.lastClientMessageAt ?? null

  let identity = {
    status: (conversation?.identityStatus ?? "unknown") as "unique" | "new" | "ambiguous" | "unknown",
    contacts: [] as Array<{ id: string; accountId: string; fullName: string; email: string | null; phone: string | null }>,
    accountId: enrollment?.account_id ?? conversation?.accountId ?? null,
    contactId: enrollment?.contact_id ?? conversation?.contactId ?? null,
  }
  if (enrollment) {
    identity = {
      ...identity,
      status: "unique",
      accountId: enrollment.account_id ?? identity.accountId,
      contactId: enrollment.contact_id ?? identity.contactId,
    }
  } else if (!conversation?.accountId) {
    try {
      identity = await resolveAssistantIdentity(admin, {
        phone: event.fromDigits,
        email: event.fromEmail,
        displayName:
          event.channel === "whatsapp"
            ? displayNameForUnknownWhatsApp(event.fromDigits ?? "", event.displayName)
            : event.displayName || event.fromEmail || "Email client",
        channel: event.channel === "cms" ? "email" : event.channel,
      })
    } catch (error) {
      console.error("[assistant-whatsapp] identity failed", error instanceof Error ? error.message : error)
    }
  }

  const linkedDealId = enrollment?.deal_id ?? conversation?.dealId ?? null

  if (!conversation) {
    let dealId = linkedDealId
    if (!dealId && identity.accountId) {
      dealId = await findOpenEnquiry(admin, identity.accountId)
      if (!dealId && identity.contactId && !enrollment) {
        dealId = await createEnquiry(admin, {
          accountId: identity.accountId,
          contactId: identity.contactId,
          source: event.channel === "whatsapp" ? "whatsapp" : "email",
          notes: event.body.slice(0, 2000),
        })
      }
    }
    conversation = await insertConversation(admin, {
      channel: event.channel,
      status: identity.status === "ambiguous" ? "needs_review" : "ai_active",
      identityStatus: identity.status,
      phoneDigits: event.fromDigits,
      email: event.fromEmail,
      displayName: enrollment?.full_name || event.displayName || identity.contacts[0]?.fullName || "",
      ourNumber: event.ourNumber,
      accountId: identity.accountId,
      contactId: identity.contactId,
      dealId,
      runAfterAt: runAfter,
      lastClientMessageAt: now.toISOString(),
    })
  } else {
    const willAuto = assistantWillAutoReplyFromSettings(
      { ...settings, killSwitch: effectiveKillSwitch(settings) },
      {
        channel: event.channel,
        status: conversation.status,
        llmConfigured: llmIsConfigured(),
      },
    )
    const patch: Record<string, unknown> = {
      last_client_message_at: now.toISOString(),
      run_after_at:
        willAuto || event.channel === "whatsapp"
          ? runAfter
          : conversation.status === "human_takeover"
            ? null
            : runAfter,
      identity_status: identity.status,
    }
    if (!conversation.accountId && identity.accountId) patch.account_id = identity.accountId
    if (!conversation.contactId && identity.contactId) patch.contact_id = identity.contactId
    if (!conversation.dealId) {
      patch.deal_id =
        linkedDealId ||
        (identity.accountId ? await findOpenEnquiry(admin, identity.accountId) : null) ||
        (identity.contactId && identity.accountId && !enrollment
          ? await createEnquiry(admin, {
              accountId: identity.accountId,
              contactId: identity.contactId,
              source: event.channel === "whatsapp" ? "whatsapp" : "email",
              notes: event.body.slice(0, 2000),
            })
          : null)
    }
    if (event.fromDigits && conversation.phoneDigits !== event.fromDigits) {
      patch.phone_digits = event.fromDigits
    }
    if (identity.status === "ambiguous") patch.status = "needs_review"
    else if (conversation.status === "closed") patch.status = "ai_active"
    try {
      await updateConversation(admin, conversation.id, patch)
    } catch (error) {
      if (patch.phone_digits) {
        delete patch.phone_digits
        await updateConversation(admin, conversation.id, patch)
      } else {
        throw error
      }
    }
    conversation = (await getConversation(admin, conversation.id)) ?? conversation
  }

  const inserted = await insertMessage(admin, {
    conversationId: conversation.id,
    direction: "inbound",
    sentBy: "client",
    channel: event.channel,
    body: event.body,
    mediaType: event.mediaType,
    providerMessageId: event.providerMessageId,
    raw: event.raw,
  })
  storeWhatsAppMedia(conversation.id, inserted.id, event, inserted.duplicate)

  if (conversation.dealId && !inserted.duplicate) {
    const classified = classifyClientMessage(event.body, isLowContentMessage(event.body, event.mediaType))
    await markEnquiryClientReplied(admin, conversation.dealId, now)
    await admin
      .from("deals")
      .update({
        enquiry_stage: "responded",
        next_action: suggestedEnquiryAction("responded"),
        updated_at: now.toISOString(),
      })
      .eq("id", conversation.dealId)
      .in("enquiry_stage", ["new", "contacted"])
    if (classified.wantsBooking || classified.sensitive) {
      await updateConversation(admin, conversation.id, { status: "needs_review" })
    }
  }

  if (event.channel === "whatsapp" && !inserted.duplicate) {
    const willAuto = assistantWillAutoReplyFromSettings(
      { ...settings, killSwitch: effectiveKillSwitch(settings) },
      {
        channel: conversation.channel,
        status: conversation.status,
        llmConfigured: llmIsConfigured(),
      },
    )
    const noticeDue = whatsAppReplyNoticeDue({
      channel: "whatsapp",
      willAutoReply: willAuto,
      mediaType: event.mediaType,
    })
    if (noticeDue && !inWhatsAppReplyNotifyBurst(previousLastClientAt, now.getTime())) {
      let dealReference: string | null = null
      if (conversation.dealId) {
        const { data: deal } = await admin.from("deals").select("reference").eq("id", conversation.dealId).maybeSingle()
        dealReference = deal?.reference ? String(deal.reference) : null
      }
      const sent = await sendAssistantStaffAlert({
        to: settings.notifyEmails,
        conversationId: conversation.id,
        clientName: conversation.displayName,
        reason: "WhatsApp reply needs a staff response.",
        draft: whatsAppReplyPreview(event.body, event.mediaType),
        kind: "reply_needed",
        dealReference,
      })
      if (sent.ok) {
        await updateConversation(admin, conversation.id, { run_after_at: null })
      } else {
        console.error("[assistant-whatsapp] reply notify failed", sent.error)
      }
    } else if (noticeDue) {
      await updateConversation(admin, conversation.id, { run_after_at: null })
    }
  }

  return {
    conversationId: conversation.id,
    messageId: inserted.id,
    duplicate: inserted.duplicate,
    takeover: false,
  }
}

export async function openCmsComposer(dealId: string): Promise<AssistantConversation> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Service role is not configured.")
  const existing = await findConversationByDeal(admin, dealId)
  if (existing) return existing
  const { data: deal, error } = await admin
    .from("deals")
    .select("id, account_id, primary_contact_id, source")
    .eq("id", dealId)
    .maybeSingle()
  if (error || !deal) throw new Error(error?.message || "Enquiry not found.")
  const [{ data: account }, { data: contact }] = await Promise.all([
    deal.account_id
      ? admin.from("crm_accounts").select("name").eq("id", deal.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
    deal.primary_contact_id
      ? admin.from("crm_contacts").select("full_name, email, phone").eq("id", deal.primary_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const channel: AssistantChannel =
    String(deal.source) === "email" ? "email" : String(deal.source) === "whatsapp" ? "whatsapp" : "cms"
  return insertConversation(admin, {
    channel,
    status: "ai_active",
    identityStatus: deal.account_id ? "unique" : "unknown",
    phoneDigits: contact?.phone ? String(contact.phone).replace(/\D/g, "") : null,
    email: contact?.email ? String(contact.email).trim().toLowerCase() : null,
    displayName: String(contact?.full_name ?? account?.name ?? "Client").trim() || "Client",
    accountId: deal.account_id ? String(deal.account_id) : null,
    contactId: deal.primary_contact_id ? String(deal.primary_contact_id) : null,
    dealId,
  })
}
