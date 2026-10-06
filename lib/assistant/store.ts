import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  AssistantChannel,
  AssistantConversation,
  AssistantDecision,
  AssistantDraft,
  AssistantIdentityStatus,
  AssistantMessage,
  AssistantStatus,
  AssistantToolTrace,
} from "@/lib/assistant/types"

type Admin = SupabaseClient

type ConversationRow = {
  id: string
  channel: AssistantChannel
  status: AssistantStatus
  identity_status: AssistantIdentityStatus
  phone_digits: string | null
  email: string | null
  display_name: string | null
  our_number: string | null
  account_id: string | null
  contact_id: string | null
  deal_id: string | null
  owner_profile_id: string | null
  run_after_at: string | null
  last_client_message_at: string | null
  last_outbound_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function mapConversation(row: ConversationRow): AssistantConversation {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    identityStatus: row.identity_status,
    phoneDigits: row.phone_digits,
    email: row.email,
    displayName: row.display_name?.trim() || "",
    ourNumber: row.our_number,
    accountId: row.account_id,
    contactId: row.contact_id,
    dealId: row.deal_id,
    ownerProfileId: row.owner_profile_id,
    runAfterAt: row.run_after_at,
    lastClientMessageAt: row.last_client_message_at,
    lastOutboundAt: row.last_outbound_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapAssistantConversation(row: ConversationRow): AssistantConversation {
  return mapConversation(row)
}

export async function findConversationByPhone(admin: Admin, digits: string): Promise<AssistantConversation | null> {
  if (digits.length < 8) return null
  const { data } = await admin
    .from("assistant_conversations")
    .select("*")
    .eq("channel", "whatsapp")
    .eq("phone_digits", digits)
    .maybeSingle()
  return data ? mapConversation(data as ConversationRow) : null
}

export async function findConversationByEmail(admin: Admin, email: string): Promise<AssistantConversation | null> {
  const { data } = await admin
    .from("assistant_conversations")
    .select("*")
    .eq("channel", "email")
    .eq("email", email)
    .maybeSingle()
  return data ? mapConversation(data as ConversationRow) : null
}

export async function findConversationByDeal(admin: Admin, dealId: string): Promise<AssistantConversation | null> {
  const { data } = await admin
    .from("assistant_conversations")
    .select("*")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? mapConversation(data as ConversationRow) : null
}

export async function getConversation(admin: Admin, id: string): Promise<AssistantConversation | null> {
  const { data } = await admin.from("assistant_conversations").select("*").eq("id", id).maybeSingle()
  return data ? mapConversation(data as ConversationRow) : null
}

export async function insertConversation(
  admin: Admin,
  input: {
    channel: AssistantChannel
    status?: AssistantStatus
    identityStatus?: AssistantIdentityStatus
    phoneDigits?: string | null
    email?: string | null
    displayName: string
    ourNumber?: string | null
    accountId?: string | null
    contactId?: string | null
    dealId?: string | null
    runAfterAt?: string | null
    lastClientMessageAt?: string | null
  },
): Promise<AssistantConversation> {
  const { data, error } = await admin
    .from("assistant_conversations")
    .insert({
      channel: input.channel,
      status: input.status ?? "ai_active",
      identity_status: input.identityStatus ?? "unknown",
      phone_digits: input.phoneDigits ?? null,
      email: input.email ?? null,
      display_name: input.displayName,
      our_number: input.ourNumber ?? null,
      account_id: input.accountId ?? null,
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      run_after_at: input.runAfterAt ?? null,
      last_client_message_at: input.lastClientMessageAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single()
  if (error || !data) throw new Error(error?.message || "Could not create conversation.")
  return mapConversation(data as ConversationRow)
}

export async function updateConversation(
  admin: Admin,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("assistant_conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw new Error(error.message)
}

export async function insertMessage(
  admin: Admin,
  input: {
    conversationId: string
    direction: "inbound" | "outbound"
    sentBy: "client" | "ai" | "staff"
    channel: AssistantChannel
    body: string
    mediaType?: string | null
    providerMessageId?: string | null
    raw?: Record<string, unknown>
    processedAt?: string | null
  },
): Promise<{ id: string; duplicate: boolean }> {
  if (input.providerMessageId) {
    const { data: existing } = await admin
      .from("assistant_messages")
      .select("id")
      .eq("provider_message_id", input.providerMessageId)
      .maybeSingle()
    if (existing?.id) return { id: String(existing.id), duplicate: true }
  }
  const { data, error } = await admin
    .from("assistant_messages")
    .insert({
      conversation_id: input.conversationId,
      direction: input.direction,
      sent_by: input.sentBy,
      channel: input.channel,
      body: input.body,
      media_type: input.mediaType ?? null,
      provider_message_id: input.providerMessageId ?? null,
      raw: input.raw ?? {},
      processed_at: input.processedAt ?? null,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505" && input.providerMessageId) {
      const { data: again } = await admin
        .from("assistant_messages")
        .select("id")
        .eq("provider_message_id", input.providerMessageId)
        .maybeSingle()
      if (again?.id) return { id: String(again.id), duplicate: true }
    }
    throw new Error(error.message)
  }
  return { id: String(data.id), duplicate: false }
}

export async function listMessages(admin: Admin, conversationId: string, limit = 80): Promise<AssistantMessage[]> {
  const { data, error } = await admin
    .from("assistant_messages")
    .select("id, conversation_id, direction, sent_by, channel, body, media_type, provider_message_id, processed_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    direction: row.direction as AssistantMessage["direction"],
    sentBy: row.sent_by as AssistantMessage["sentBy"],
    channel: row.channel as AssistantMessage["channel"],
    body: String(row.body ?? ""),
    mediaType: row.media_type == null ? null : String(row.media_type),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    processedAt: row.processed_at == null ? null : String(row.processed_at),
    createdAt: String(row.created_at),
  }))
}

export async function latestPendingDraft(admin: Admin, conversationId: string): Promise<AssistantDraft | null> {
  const { data } = await admin
    .from("assistant_drafts")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return {
    id: String(data.id),
    conversationId: String(data.conversation_id),
    runId: data.run_id == null ? null : String(data.run_id),
    body: String(data.body),
    status: data.status as AssistantDraft["status"],
    intent: String(data.intent ?? "answer"),
    createdAt: String(data.created_at),
  }
}

export async function insertDraft(
  admin: Admin,
  input: { conversationId: string; runId: string | null; body: string; intent: string },
): Promise<string> {
  await admin
    .from("assistant_drafts")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("conversation_id", input.conversationId)
    .eq("status", "pending")
  const { data, error } = await admin
    .from("assistant_drafts")
    .insert({
      conversation_id: input.conversationId,
      run_id: input.runId,
      body: input.body,
      intent: input.intent,
      status: "pending",
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(error?.message || "Could not save draft.")
  return String(data.id)
}

export async function insertRun(
  admin: Admin,
  input: {
    conversationId: string
    triggerMessageId: string | null
    decision: AssistantDecision
    confidence: number | null
    model: string | null
    toolTrace: AssistantToolTrace[]
    outputText: string
    reason: string
    status?: "completed" | "failed"
  },
): Promise<string> {
  const { data, error } = await admin
    .from("assistant_runs")
    .insert({
      conversation_id: input.conversationId,
      trigger_message_id: input.triggerMessageId,
      status: input.status ?? "completed",
      decision: input.decision,
      confidence: input.confidence,
      model: input.model,
      tool_trace: input.toolTrace,
      output_text: input.outputText,
      reason: input.reason,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(error?.message || "Could not save assistant run.")
  return String(data.id)
}

export async function markMessagesProcessed(admin: Admin, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await admin.from("assistant_messages").update({ processed_at: new Date().toISOString() }).in("id", ids)
}

export async function dueConversations(admin: Admin, limit = 10): Promise<AssistantConversation[]> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("assistant_conversations")
    .select("*")
    .in("status", ["ai_active", "needs_review"])
    .not("run_after_at", "is", null)
    .lte("run_after_at", now)
    .order("run_after_at", { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapConversation(row as ConversationRow))
}

export async function countNeedsReview(admin: Admin): Promise<number> {
  const { count } = await admin
    .from("assistant_conversations")
    .select("id", { count: "exact", head: true })
    .eq("status", "needs_review")
  return count ?? 0
}

export async function listInbox(
  admin: Admin,
  filter: { status?: AssistantStatus | "all" },
): Promise<AssistantConversation[]> {
  let query = admin.from("assistant_conversations").select("*").order("updated_at", { ascending: false }).limit(200)
  if (filter.status && filter.status !== "all") query = query.eq("status", filter.status)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapConversation(row as ConversationRow))
}
