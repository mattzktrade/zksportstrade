import { createAdminClient } from "@/lib/supabase/admin"
import { listCallAttemptsForDeals } from "@/lib/crm/call-attempts-store"
import { CALL_OUTCOME_LABELS, type EnquiryCallAttempt } from "@/lib/crm/call-outcomes"
import { ENQUIRY_PIPELINE_STAGES } from "@/lib/crm/deal-pipeline"
import { DEFAULT_LEAD_TIMEZONE } from "@/lib/crm/lead-timezone"
import {
  FOLLOW_UP_CLOSED_SUMMARY,
  FOLLOW_UP_NEXT_ACTION,
  earliestTime,
  firstConnectedCall,
  firstFollowUpReminderAt,
  followUpAutoCloseDue,
  followUpMoveDue,
  followUpReminderDue,
  latestConnectedCall,
  latestTime,
} from "@/lib/crm/marketing-follow-up"
import { MARKETING_LEAD_NOTIFY_EMAILS } from "@/lib/integrations/marketing-leads/notify"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { sendFollowUpReminder } from "@/lib/email/send-follow-up-reminder"

export type DecidingFollowUpResult = {
  moved: number
  reminded: number
  closed: number
  failed: number
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

type Person = { full_name: string | null; phone: string | null; email: string | null }

const CHUNK = 80

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function describeCall(call: EnquiryCallAttempt | null): string | null {
  if (!call) return null
  const when = new Date(call.created_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_LEAD_TIMEZONE,
  })
  const note = call.notes?.trim().slice(0, 160)
  return [when, CALL_OUTCOME_LABELS[call.outcome], note].filter(Boolean).join(" · ")
}

/** Latest client WhatsApp or email per enquiry, from the Inbox. */
async function lastClientMessages(admin: AdminClient, dealIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < dealIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("assistant_conversations")
      .select("deal_id, last_client_message_at")
      .in("deal_id", dealIds.slice(i, i + CHUNK))
      .not("last_client_message_at", "is", null)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const id = String(row.deal_id)
      const at = latestTime(out.get(id), String(row.last_client_message_at))
      if (at) out.set(id, at)
    }
  }
  return out
}

async function moveInConversationToDeciding(admin: AdminClient, now: Date): Promise<number> {
  const { data, error } = await admin
    .from("deals")
    .select("id, next_action_due_at, enquiry_replied_at, updated_at")
    .eq("enquiry_stage", "contacted")
    .in("stage", [...ENQUIRY_PIPELINE_STAGES])
    .limit(500)
  if (error) {
    console.error("[deciding-follow-up] in-conversation query", error.message)
    return 0
  }
  const deals = data ?? []
  const calls = await listCallAttemptsForDeals(deals.map((row) => String(row.id)))
  let moved = 0
  for (const deal of deals) {
    const firstCall = firstConnectedCall(calls[String(deal.id)])
    const replied = (deal.enquiry_replied_at as string | null) ?? null
    // Staff can move a lead to In conversation by hand with no call or reply logged; time that from the change.
    const conversationAt =
      earliestTime(firstCall?.created_at, replied) ?? ((deal.updated_at as string | null) ?? null)
    const nextActionDueAt = (deal.next_action_due_at as string | null) ?? null
    if (!followUpMoveDue({ conversationAt, nextActionDueAt, now })) continue
    const { data: updated } = await admin
      .from("deals")
      .update({
        enquiry_stage: "follow_up",
        stage: "proposal",
        next_action: FOLLOW_UP_NEXT_ACTION,
        next_action_due_at: firstFollowUpReminderAt(now).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", deal.id)
      .eq("enquiry_stage", "contacted")
      .select("id")
      .maybeSingle()
    if (!updated) continue
    moved += 1
    await admin.from("deal_activities").insert({
      deal_id: deal.id,
      actor_profile_id: null,
      action: "enquiry_stage_changed",
      summary: "Moved to Deciding a day after the first conversation",
      metadata: { from: "contacted", to: "follow_up", conversationAt },
    })
  }
  return moved
}

async function remindOrClose(
  admin: AdminClient,
  now: Date,
): Promise<{ reminded: number; closed: number; failed: number }> {
  const result = { reminded: 0, closed: 0, failed: 0 }
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, reference, source, owner_profile_id, next_action_due_at, enquiry_replied_at, updated_at, crm_contacts!primary_contact_id ( full_name, phone, email ), races ( name )",
    )
    .eq("enquiry_stage", "follow_up")
    .in("stage", [...ENQUIRY_PIPELINE_STAGES])
    .or(`next_action_due_at.is.null,next_action_due_at.lte."${now.toISOString()}"`)
    .limit(500)
  if (error) {
    console.error("[deciding-follow-up] deciding query", error.message)
    return result
  }
  const deals = data ?? []
  if (deals.length === 0) return result
  const dealIds = deals.map((row) => String(row.id))
  const calls = await listCallAttemptsForDeals(dealIds)
  let messages: Map<string, string>
  const remindersByDeal = new Map<string, string[]>()
  try {
    messages = await lastClientMessages(admin, dealIds)
    for (let i = 0; i < dealIds.length; i += CHUNK) {
      const { data: reminderRows, error: reminderError } = await admin
        .from("deal_activities")
        .select("deal_id, created_at")
        .in("deal_id", dealIds.slice(i, i + CHUNK))
        .eq("action", "follow_up_reminder")
        .order("created_at", { ascending: false })
        .limit(5000)
      if (reminderError) throw new Error(reminderError.message)
      for (const row of reminderRows ?? []) {
        const list = remindersByDeal.get(String(row.deal_id)) ?? []
        list.push(String(row.created_at))
        remindersByDeal.set(String(row.deal_id), list)
      }
    }
  } catch (historyError) {
    // Without history we could repeat a reminder or close a lead someone just spoke to.
    console.error("[deciding-follow-up] history", historyError instanceof Error ? historyError.message : historyError)
    return result
  }

  const ownerIds = [...new Set(deals.map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  const ownerEmails = new Map<string, string>()
  if (ownerIds.length > 0) {
    const { data: owners } = await admin.from("profiles").select("id, email").in("id", ownerIds)
    for (const row of owners ?? []) {
      const email = String(row.email ?? "").trim()
      if (email) ownerEmails.set(String(row.id), email)
    }
  }

  for (const deal of deals) {
    const dealId = String(deal.id)
    const lastCall = latestConnectedCall(calls[dealId])
    const lastConversationAt = latestTime(
      lastCall?.created_at,
      (deal.enquiry_replied_at as string | null) ?? null,
      messages.get(dealId),
    )
    const since = lastConversationAt ? Date.parse(lastConversationAt) : Number.NEGATIVE_INFINITY
    const prior = (remindersByDeal.get(dealId) ?? []).filter((at) => Date.parse(at) > since)
    const nextActionDueAt = (deal.next_action_due_at as string | null) ?? null
    const schedule = {
      nextActionDueAt,
      remindersSent: prior.length,
      lastReminderAt: prior[0] ?? null,
      lastConversationAt,
      now,
    }

    if (followUpAutoCloseDue(schedule)) {
      const { data: closed } = await admin
        .from("deals")
        .update({
          enquiry_stage: "not_interested",
          enquiry_temperature: "cold",
          next_action: "No further action",
          next_action_due_at: null,
          updated_at: now.toISOString(),
        })
        .eq("id", dealId)
        .eq("enquiry_stage", "follow_up")
        .eq("updated_at", String(deal.updated_at))
        .select("id")
        .maybeSingle()
      if (!closed) continue
      result.closed += 1
      await admin.from("deal_activities").insert({
        deal_id: dealId,
        actor_profile_id: null,
        action: "enquiry_stage_changed",
        summary: FOLLOW_UP_CLOSED_SUMMARY,
        metadata: { from: "follow_up", to: "not_interested", lastReminderAt: prior[0] ?? null },
      })
      await stopMarketingOutreach(dealId, "not_interested").catch(() => undefined)
      continue
    }

    if (!followUpReminderDue(schedule)) continue
    const ownerEmail = deal.owner_profile_id ? ownerEmails.get(String(deal.owner_profile_id)) : undefined
    const to = ownerEmail ? [ownerEmail] : deal.source === "marketing" ? [...MARKETING_LEAD_NOTIFY_EMAILS] : []
    // Nobody to email: the lead stays on the dashboard as overdue and is not counted down to closing.
    if (to.length === 0) continue
    const reminderNo = prior.length + 1

    const { data: claimed } = await admin
      .from("deals")
      .update({ updated_at: now.toISOString() })
      .eq("id", dealId)
      .eq("enquiry_stage", "follow_up")
      .eq("updated_at", String(deal.updated_at))
      .select("id")
      .maybeSingle()
    if (!claimed) continue

    const contact = one(deal.crm_contacts as Person | Person[] | null)
    const race = one(deal.races as { name: string | null } | Array<{ name: string | null }> | null)
    const sent = await sendFollowUpReminder({
      to,
      dealId,
      reference: String(deal.reference ?? ""),
      name: contact?.full_name?.trim() || "Lead",
      phone: contact?.phone?.trim() || null,
      email: contact?.email?.trim() || null,
      event: race?.name?.trim() || null,
      reminderNo,
      lastSpoke: describeCall(lastCall),
    })
    if (!sent.ok) {
      result.failed += 1
      console.error("[deciding-follow-up] reminder failed", dealId, sent.error)
      continue
    }
    result.reminded += 1
    await admin.from("deal_activities").insert({
      deal_id: dealId,
      actor_profile_id: null,
      action: "follow_up_reminder",
      summary: `Deciding reminder ${reminderNo} of 3 emailed`,
      metadata: { reminderNo },
    })
  }
  return result
}

/**
 * Every lead: In conversation → Deciding a day after the first conversation,
 * three reminders to the owner, then Not interested a week after the last.
 */
export async function processDecidingFollowUps(now = new Date()): Promise<DecidingFollowUpResult> {
  const admin = createAdminClient()
  if (!admin) return { moved: 0, reminded: 0, closed: 0, failed: 0 }
  const moved = await moveInConversationToDeciding(admin, now)
  const { reminded, closed, failed } = await remindOrClose(admin, now)
  return { moved, reminded, closed, failed }
}
