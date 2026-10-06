import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { DEFAULT_SALES_POLICY_BODY, DEFAULT_SALES_POLICY_SLUG } from "@/lib/assistant/knowledge"
import { classifyClientMessage, isLowContentMessage } from "@/lib/assistant/classify"
import { completeAssistantTurn, buildAssistantSystemPrompt } from "@/lib/assistant/llm"
import { sendAssistantStaffAlert } from "@/lib/assistant/notifications"
import { decideAssistantAction, withinCustomerWindow } from "@/lib/assistant/policy"
import { effectiveKillSwitch, llmIsConfigured, loadAssistantSettings } from "@/lib/assistant/settings"
import {
  getConversation,
  insertDraft,
  insertMessage,
  insertRun,
  listMessages,
  markMessagesProcessed,
  updateConversation,
} from "@/lib/assistant/store"
import { emptyToolFacts, type AssistantToolFacts } from "@/lib/assistant/tools"
import { sendAssistantEmailReply } from "@/lib/assistant/email-send"
import { sendWhatsAppText } from "@/lib/assistant/whatsapp-send"
import type { AssistantConversation, AssistantDecision, AssistantIntent } from "@/lib/assistant/types"
import type { SupabaseClient } from "@supabase/supabase-js"
import { SOURCING_REQUIRED_EMAIL } from "@/lib/crm/sourcing-notifications"
import { deliverSourcingStageNotification } from "@/lib/email/send-sourcing-notification"

function lastUnprocessedInbound(messages: Awaited<ReturnType<typeof listMessages>>) {
  const inbound = messages.filter((row) => row.direction === "inbound" && row.sentBy === "client")
  return inbound.filter((row) => !row.processedAt)
}

function combinedClientText(messages: Awaited<ReturnType<typeof listMessages>>): string {
  return lastUnprocessedInbound(messages)
    .map((row) => row.body.trim())
    .filter(Boolean)
    .join("\n")
}

async function loadStyleAndPolicy(
  admin: SupabaseClient,
  accountId: string | null,
): Promise<{ policy: string; examples: string[] }> {
  const { data: policy } = await admin
    .from("knowledge_articles")
    .select("body")
    .eq("slug", DEFAULT_SALES_POLICY_SLUG)
    .eq("active", true)
    .maybeSingle()
  const { data: examples } = await admin
    .from("knowledge_examples")
    .select("answer, question, account_id")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20)
  const style = (examples ?? [])
    .filter((row) => !row.account_id || row.account_id === accountId)
    .slice(0, 6)
    .map((row) => (row.question ? `${row.question} → ${row.answer}` : String(row.answer)))
  return {
    policy: String(policy?.body ?? DEFAULT_SALES_POLICY_BODY),
    examples: style,
  }
}

async function markSourcingRequired(admin: SupabaseClient, conversation: AssistantConversation) {
  if (!conversation.dealId) return
  const { data: deal } = await admin
    .from("deals")
    .select("id, reference, stage, enquiry_stage, notes, crm_accounts(name)")
    .eq("id", conversation.dealId)
    .maybeSingle()
  if (!deal) return
  const previous = { stage: String(deal.stage), enquiry_stage: deal.enquiry_stage as string | null }
  await admin
    .from("deals")
    .update({
      enquiry_stage: "sourcing_required",
      stage: "sourcing",
      next_action: suggestedEnquiryAction("sourcing_required"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.dealId)
  const account = Array.isArray(deal.crm_accounts) ? deal.crm_accounts[0] : deal.crm_accounts
  await deliverSourcingStageNotification(
    {
      id: String(deal.id),
      reference: String(deal.reference ?? ""),
      stage: "sourcing",
      enquiryStage: "sourcing_required",
      clientName: (account as { name?: string } | null)?.name?.trim() || conversation.displayName,
      interest: conversation.displayName,
      notes: typeof deal.notes === "string" ? deal.notes : undefined,
    },
    "sourcing_required",
  )
  void previous
  void SOURCING_REQUIRED_EMAIL
}

function factsFromMessages(conversation: AssistantConversation, facts: AssistantToolFacts, classified: ReturnType<typeof classifyClientMessage>) {
  return {
    identity: conversation.identityStatus,
    packageResolution: facts.packageResolution,
    factsMissing: facts.factsMissing,
    toolFailed: facts.toolFailed,
    wantsPriceCommit: classified.wantsPrice,
    wantsBooking: classified.wantsBooking,
    dealHasPricedLines: facts.dealHasPricedLines,
    dealHasPackage: facts.dealHasPackage,
    dealHasQuantity: facts.dealHasQuantity,
    sensitiveTopic: classified.sensitive,
    stockStatus: facts.stockStatus,
    mediaOnly: classified.mediaOnly,
  }
}

async function sendOutbound(
  admin: SupabaseClient,
  conversation: AssistantConversation,
  body: string,
  sentBy: "ai" | "staff",
): Promise<{ ok: true; providerId: string | null } | { ok: false; error: string }> {
  if (conversation.channel === "whatsapp") {
    if (!conversation.phoneDigits) return { ok: false, error: "No WhatsApp number on this conversation." }
    const sent = await sendWhatsAppText({ toPhoneDigits: conversation.phoneDigits, body })
    if (!sent.ok) return { ok: false, error: sent.error || sent.skipped || "WhatsApp send failed." }
    await insertMessage(admin, {
      conversationId: conversation.id,
      direction: "outbound",
      sentBy,
      channel: "whatsapp",
      body,
      providerMessageId: sent.id,
      processedAt: new Date().toISOString(),
    })
    return { ok: true, providerId: sent.id }
  }
  if (conversation.channel === "email") {
    if (!conversation.email) return { ok: false, error: "No email on this conversation." }
    const sent = await sendAssistantEmailReply({
      to: conversation.email,
      subject: "ZK Sports",
      text: body,
    })
    if (!sent.ok) return { ok: false, error: sent.error }
    await insertMessage(admin, {
      conversationId: conversation.id,
      direction: "outbound",
      sentBy,
      channel: "email",
      body,
      processedAt: new Date().toISOString(),
    })
    return { ok: true, providerId: null }
  }
  await insertMessage(admin, {
    conversationId: conversation.id,
    direction: "outbound",
    sentBy,
    channel: "cms",
    body,
    processedAt: new Date().toISOString(),
  })
  return { ok: true, providerId: null }
}

export async function runAssistantConversation(
  admin: SupabaseClient,
  conversationId: string,
  options?: { forceDraft?: boolean },
): Promise<{ decision: AssistantDecision; reason: string }> {
  const conversation = await getConversation(admin, conversationId)
  if (!conversation) return { decision: "skipped", reason: "Conversation not found." }
  const settings = await loadAssistantSettings(admin)
  const messages = await listMessages(admin, conversationId)
  const pending = lastUnprocessedInbound(messages)
  if (pending.length === 0) {
    await updateConversation(admin, conversationId, { run_after_at: null })
    return { decision: "skipped", reason: "No new inbound messages." }
  }

  const clientText = combinedClientText(messages)
  const latest = pending[pending.length - 1]
  const classified = classifyClientMessage(
    clientText,
    isLowContentMessage(latest.body, latest.mediaType),
  )
  const { policy, examples } = await loadStyleAndPolicy(admin, conversation.accountId)
  let llm
  try {
    llm = await completeAssistantTurn({
      ctx: {
        admin,
        accountId: conversation.accountId,
        contactId: conversation.contactId,
        dealId: conversation.dealId,
        allowPublishedTradePrices: settings.allowPublishedTradePrices,
      },
      system: buildAssistantSystemPrompt({
        policy,
        styleExamples: examples,
        clientName: conversation.displayName,
      }),
      user: [
        `Channel: ${conversation.channel}`,
        `Identity: ${conversation.identityStatus}`,
        conversation.dealId ? `Deal: ${conversation.dealId}` : "No deal linked yet.",
        "",
        clientText || "(no text)",
      ].join("\n"),
    })
  } catch (error) {
    llm = {
      reply: "Thanks for this — I am checking with the team and will come back to you shortly.",
      confidence: 0,
      intent: "unclear" as AssistantIntent,
      packageIds: [] as string[],
      needsHuman: true,
      reason: error instanceof Error ? error.message : "Language model failed.",
      toolTrace: [],
      model: "error",
    }
  }

  const factsFromLlm: AssistantToolFacts = {
    ...emptyToolFacts(),
    packageIds: llm.packageIds,
    packageResolution: llm.packageIds.length > 1 ? "ambiguous" : llm.packageIds.length === 1 ? "unique" : "none",
  }
  for (const trace of llm.toolTrace) {
    const record = trace.result && typeof trace.result === "object" ? (trace.result as Record<string, unknown>) : {}
    if (record.error) factsFromLlm.toolFailed = true
    if (typeof record.sellable === "number") {
      factsFromLlm.stockStatus = record.sellable > 0 ? "in_stock" : "out"
    }
    if (Array.isArray(record.stock)) {
      const rows = record.stock as Array<{ sellable?: number | null; known?: boolean }>
      const known = rows.filter((row) => row.known !== false)
      if (known.some((row) => (row.sellable ?? 0) <= 0)) factsFromLlm.stockStatus = "out"
      else if (known.length > 0 && known.every((row) => (row.sellable ?? 0) > 0)) factsFromLlm.stockStatus = "in_stock"
    }
    if (Array.isArray(record.lines)) {
      const lines = record.lines as Array<{ package_id?: string; quantity?: number; unit_sale_price?: number }>
      factsFromLlm.dealHasPackage = lines.some((line) => Boolean(line.package_id))
      factsFromLlm.dealHasQuantity = lines.some((line) => Number(line.quantity) > 0)
      factsFromLlm.dealHasPricedLines = lines.some((line) => Number(line.unit_sale_price) > 0)
    }
    if (record.portal === true) factsFromLlm.portalCapable = true
  }
  if (classified.portalHint && factsFromLlm.portalCapable) {
    llm.intent = "portal"
  }

  const policyInput = {
    killSwitch: settings.killSwitch,
    autoSendEnabled: settings.autoSendEnabled && !options?.forceDraft,
    llmConfigured: llmIsConfigured() && llm.model !== "none" && llm.model !== "error",
    envKillSwitch: effectiveKillSwitch(settings),
    confidence: llm.confidence,
    humanTakeover: conversation.status === "human_takeover",
    withinCustomerWindow:
      conversation.channel !== "whatsapp" || withinCustomerWindow(conversation.lastClientMessageAt),
    allowPublishedTradePrices: settings.allowPublishedTradePrices,
    intent: llm.intent,
    needsHuman: llm.needsHuman,
    ...factsFromMessages(conversation, factsFromLlm, classified),
  }
  const decision = decideAssistantAction(policyInput)

  const runId = await insertRun(admin, {
    conversationId,
    triggerMessageId: latest.id,
    decision: decision.decision,
    confidence: llm.confidence,
    model: llm.model,
    toolTrace: llm.toolTrace,
    outputText: llm.reply,
    reason: decision.reason,
  })
  await insertDraft(admin, {
    conversationId,
    runId,
    body: llm.reply,
    intent: llm.intent,
  })
  await markMessagesProcessed(
    admin,
    pending.map((row) => row.id),
  )

  let status = conversation.status
  if (decision.notifyStaff) status = "needs_review"
  if (decision.decision === "prepare_booking_form" || decision.decision === "source") status = "needs_review"

  if (decision.decision === "source") {
    await markSourcingRequired(admin, conversation)
  }

  if (decision.autoSend && decision.decision === "sent") {
    const sent = await sendOutbound(admin, conversation, llm.reply, "ai")
    if (!sent.ok) {
      await updateConversation(admin, conversationId, {
        status: "needs_review",
        last_error: sent.error,
        run_after_at: null,
      })
      await sendAssistantStaffAlert({
        to: settings.notifyEmails,
        conversationId,
        clientName: conversation.displayName,
        reason: `Auto-send failed: ${sent.error}`,
        draft: llm.reply,
        kind: "review",
      })
      return { decision: "escalated", reason: sent.error }
    }
    await updateConversation(admin, conversationId, {
      status: "ai_active",
      last_outbound_at: new Date().toISOString(),
      last_error: null,
      run_after_at: null,
    })
    if (conversation.dealId) {
      await admin.from("deal_activities").insert({
        deal_id: conversation.dealId,
        action: "assistant_sent",
        summary: "Sales assistant sent a WhatsApp/email reply.",
        metadata: { conversation_id: conversationId, run_id: runId },
      })
    }
    return { decision: "sent", reason: decision.reason }
  }

  await updateConversation(admin, conversationId, {
    status,
    last_error: null,
    run_after_at: null,
  })

  if (decision.notifyStaff) {
    await sendAssistantStaffAlert({
      to: settings.notifyEmails,
      conversationId,
      clientName: conversation.displayName,
      reason: decision.reason,
      draft: llm.reply,
      kind:
        decision.decision === "prepare_booking_form"
          ? "booking_form"
          : decision.decision === "source"
            ? "source"
            : "review",
    })
  }

  return { decision: decision.decision, reason: decision.reason }
}

export { sendOutbound }
