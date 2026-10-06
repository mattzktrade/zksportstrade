"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { notifyNativeBookingFormReady } from "@/app/(admin)/admin/deals/booking-form-actions"
import { buildBookingFormSnapshot } from "@/lib/booking-forms/snapshot"
import { snapshotToEdits } from "@/lib/booking-forms/edits"
import { openCmsComposer } from "@/lib/assistant/ingest"
import { saveStyleExample, promoteApprovedQa, styleExampleFromEdit } from "@/lib/assistant/learning"
import { runAssistantConversation, sendOutbound } from "@/lib/assistant/run"
import {
  getConversation,
  latestPendingDraft,
  listMessages,
  updateConversation,
} from "@/lib/assistant/store"
import { ASSISTANT_INBOX_HREF } from "@/lib/assistant/types"

function revalidateAssistant(conversationId?: string) {
  revalidatePath(ASSISTANT_INBOX_HREF)
  revalidatePath(`${ASSISTANT_INBOX_HREF}/readiness`)
  revalidatePath(`${ASSISTANT_INBOX_HREF}/knowledge`)
  if (conversationId) revalidatePath(`${ASSISTANT_INBOX_HREF}/${conversationId}`)
}

export async function sendAssistantDraft(input: {
  conversationId: string
  body: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "You do not have permission to send replies." }
  }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  const conversation = await getConversation(admin, input.conversationId)
  if (!conversation) return { ok: false, message: "Conversation not found." }
  const draft = await latestPendingDraft(admin, conversation.id)
  const body = input.body.trim()
  if (!body) return { ok: false, message: "Write a reply first." }
  const sent = await sendOutbound(admin, conversation, body, "staff")
  if (!sent.ok) return { ok: false, message: sent.error }
  if (draft) {
    await admin
      .from("assistant_drafts")
      .update({ status: "sent", body, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
    const example = styleExampleFromEdit(draft.body, body)
    if (example) {
      await saveStyleExample(admin, {
        accountId: conversation.accountId,
        contactId: conversation.contactId,
        question: (await listMessages(admin, conversation.id)).filter((row) => row.sentBy === "client").at(-1)?.body ?? "",
        answer: example,
        source: "staff_edit",
      })
    }
  }
  await updateConversation(admin, conversation.id, {
    status: "ai_active",
    last_outbound_at: new Date().toISOString(),
    last_error: null,
  })
  if (conversation.dealId) {
    await admin.from("deal_activities").insert({
      deal_id: conversation.dealId,
      actor_profile_id: profile.id,
      action: "assistant_staff_sent",
      summary: "Staff sent a sales assistant reply.",
      metadata: { conversation_id: conversation.id },
    })
  }
  revalidateAssistant(conversation.id)
  return { ok: true }
}

export async function takeOverAssistantConversation(
  conversationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  await updateConversation(admin, conversationId, {
    status: "human_takeover",
    owner_profile_id: profile.id,
    run_after_at: null,
  })
  revalidateAssistant(conversationId)
  return { ok: true }
}

export async function resumeAssistantConversation(
  conversationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  await updateConversation(admin, conversationId, { status: "ai_active", last_error: null })
  revalidateAssistant(conversationId)
  return { ok: true }
}

export async function runAssistantNow(
  conversationId: string,
): Promise<{ ok: true; reason: string } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  try {
    const result = await runAssistantConversation(admin, conversationId, { forceDraft: true })
    revalidateAssistant(conversationId)
    return { ok: true, reason: result.reason }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Assistant failed." }
  }
}

export async function saveAssistantKnowledge(input: {
  conversationId: string
  question: string
  answer: string
  packageId?: string | null
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  const promoted = await promoteApprovedQa(admin, {
    question: input.question,
    answer: input.answer,
    packageId: input.packageId,
  })
  if (!promoted.ok) return promoted
  const conversation = await getConversation(admin, input.conversationId)
  await saveStyleExample(admin, {
    accountId: conversation?.accountId ?? null,
    contactId: conversation?.contactId ?? null,
    question: input.question,
    answer: input.answer,
    source: "approved_qa",
  })
  revalidateAssistant(input.conversationId)
  return {
    ok: true,
    message:
      promoted.target === "package_faq"
        ? "Saved on the product FAQ list for next time."
        : "Saved to the company knowledge base.",
  }
}

export async function updateAssistantSettingsAction(input: {
  autoSendEnabled: boolean
  killSwitch: boolean
  allowPublishedTradePrices: boolean
  notifyEmails: string
  debounceSeconds: number
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "settings.manage")) {
    return { ok: false, message: "Only an admin can change assistant settings." }
  }
  const supabase = await createClient()
  const emails = input.notifyEmails
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes("@"))
  const { error } = await supabase
    .from("assistant_settings")
    .update({
      auto_send_enabled: input.autoSendEnabled,
      kill_switch: input.killSwitch,
      allow_published_trade_prices: input.allowPublishedTradePrices,
      notify_emails: emails.length ? emails : ["matt@zk-sports.com"],
      debounce_seconds: Math.min(120, Math.max(0, Math.floor(input.debounceSeconds))),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default")
  if (error) return { ok: false, message: error.message }
  revalidateAssistant()
  return { ok: true }
}

export async function prepareAssistantBookingForm(
  conversationId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }
  const conversation = await getConversation(admin, conversationId)
  if (!conversation?.dealId) return { ok: false, message: "Link an enquiry before preparing a booking form." }
  const supabase = await createClient()
  const { snapshot } = await buildBookingFormSnapshot(supabase, conversation.dealId, `ZK-ASSIST-${Date.now()}`)
  const edits = snapshotToEdits(snapshot)
  const notified = await notifyNativeBookingFormReady({ dealId: conversation.dealId, edits })
  if (!notified.ok) return notified
  await updateConversation(admin, conversationId, { status: "needs_review" })
  revalidateAssistant(conversationId)
  return { ok: true, message: notified.message }
}

export async function saveKnowledgeArticleAction(input: {
  title: string
  body: string
  category: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await requireAdmin()
  if (!hasCmsPermission(profile, "deals.manage")) return { ok: false, message: "Permission denied." }
  const supabase = await createClient()
  const slug = `${input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${Date.now().toString(36)}`
  const { error } = await supabase.from("knowledge_articles").insert({
    slug,
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category.trim() || "general",
    active: true,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`${ASSISTANT_INBOX_HREF}/knowledge`)
  return { ok: true }
}

export async function openAssistantForDealAction(
  dealId: string,
): Promise<{ ok: true; conversationId: string } | { ok: false; message: string }> {
  await requireAdmin()
  try {
    const conversation = await openCmsComposer(dealId.trim())
    revalidateAssistant(conversation.id)
    return { ok: true, conversationId: conversation.id }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not open the assistant." }
  }
}
