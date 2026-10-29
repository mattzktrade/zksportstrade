import { createAdminClient } from "@/lib/supabase/admin"
import { inboxWaitState } from "@/lib/assistant/inbox"
import { listCallAttemptsForDeals } from "@/lib/crm/call-attempts-store"
import { CALL_OUTCOME_LABELS, enquiryCallDueAt, enquiryNeedsCall } from "@/lib/crm/call-outcomes"
import { adminEnquiryListPath } from "@/lib/crm/deal-pipeline"

export const INBOX_NEEDS_REPLY_HREF = "/admin/assistant?view=needs_reply"
export const INBOX_REPLIED_HREF = "/admin/assistant?view=replied"
export const CALL_LIST_HREF = "/admin/enquiries?view=calls"
export function followUpListHref(ownerProfileId?: string | null): string {
  return ownerProfileId ? `/admin/enquiries?stage=follow_up&owner=${ownerProfileId}` : "/admin/enquiries?stage=follow_up"
}

export type FollowUpCallRow = {
  id: string
  kind: "call" | "follow_up"
  href: string
  reference: string
  name: string
  interest: string
  phone: string | null
  attempts: number
  lastOutcome: string | null
  dueAt: number
}

export type FollowUpSummary = {
  inboxNeedsReply: number
  inboxRepliesThisWeek: number
  callsDueNow: number
  callsDueToday: number
  followUpsDueNow: number
  calls: FollowUpCallRow[]
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/**
 * Shared inbox counts, marketing calls due and Deciding follow-ups. Pass an owner to limit follow-ups
 * to their own leads and calls to theirs plus unclaimed marketing leads (someone has to claim those).
 */
export async function loadFollowUpSummary(input: { ownerProfileId?: string | null; now?: Date } = {}): Promise<FollowUpSummary> {
  const empty: FollowUpSummary = {
    inboxNeedsReply: 0,
    inboxRepliesThisWeek: 0,
    callsDueNow: 0,
    callsDueToday: 0,
    followUpsDueNow: 0,
    calls: [],
  }
  const admin = createAdminClient()
  if (!admin) return empty
  const now = input.now ?? new Date()
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000

  const [inboxRes, dealsRes, followUpRes] = await Promise.all([
    admin
      .from("assistant_conversations")
      .select("status, last_client_message_at, last_outbound_at")
      .not("last_client_message_at", "is", null)
      .neq("status", "closed")
      .order("last_client_message_at", { ascending: false })
      .limit(1000),
    (() => {
      let query = admin
        .from("deals")
        .select(
          "id, reference, source, stage, enquiry_stage, created_at, next_action_due_at, owner_profile_id, crm_contacts!primary_contact_id ( full_name, phone ), races ( name )",
        )
        .eq("source", "marketing")
        .eq("enquiry_stage", "new")
        .in("stage", ["draft", "sourcing", "proposal"])
        .gte("created_at", new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .limit(500)
      if (input.ownerProfileId) {
        query = query.or(`owner_profile_id.eq.${input.ownerProfileId},owner_profile_id.is.null`)
      }
      return query
    })(),
    (() => {
      let query = admin
        .from("deals")
        .select("id, reference, next_action_due_at, crm_contacts!primary_contact_id ( full_name, phone ), races ( name )")
        .eq("enquiry_stage", "follow_up")
        .in("stage", ["draft", "sourcing", "proposal"])
        .not("next_action_due_at", "is", null)
        .lte("next_action_due_at", now.toISOString())
        .order("next_action_due_at", { ascending: true })
        .limit(200)
      if (input.ownerProfileId) query = query.eq("owner_profile_id", input.ownerProfileId)
      return query
    })(),
  ])

  let inboxNeedsReply = 0
  let inboxRepliesThisWeek = 0
  for (const row of inboxRes.data ?? []) {
    const lastClient = row.last_client_message_at ? String(row.last_client_message_at) : null
    const wait = inboxWaitState({
      lastClientMessageAt: lastClient,
      lastOutboundAt: row.last_outbound_at ? String(row.last_outbound_at) : null,
    })
    if (wait === "replied") inboxNeedsReply += 1
    if (lastClient && Date.parse(lastClient) >= weekAgo) inboxRepliesThisWeek += 1
  }

  const deals = dealsRes.data ?? []
  const calls = await listCallAttemptsForDeals(deals.map((row) => String(row.id)))
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  const rows: FollowUpCallRow[] = []
  for (const deal of deals) {
    const shape = {
      source: String(deal.source),
      stage: String(deal.stage),
      enquiry_stage: deal.enquiry_stage as string | null,
      created_at: String(deal.created_at),
      next_action_due_at: (deal.next_action_due_at as string | null) ?? null,
    }
    const summary = calls[String(deal.id)]
    if (!enquiryNeedsCall(shape, summary)) continue
    const dueAt = enquiryCallDueAt(shape, summary)
    if (dueAt > endOfToday.getTime()) continue
    const contact = one(deal.crm_contacts as { full_name: string | null; phone: string | null } | Array<{ full_name: string | null; phone: string | null }> | null)
    const race = one(deal.races as { name: string | null } | Array<{ name: string | null }> | null)
    rows.push({
      id: String(deal.id),
      kind: "call",
      href: adminEnquiryListPath(String(deal.id)),
      reference: String(deal.reference ?? ""),
      name: contact?.full_name?.trim() || "Lead",
      interest: race?.name?.trim() || "",
      phone: contact?.phone?.trim() || null,
      attempts: summary?.attempts ?? 0,
      lastOutcome: summary?.lastOutcome ? CALL_OUTCOME_LABELS[summary.lastOutcome] : null,
      dueAt,
    })
  }
  const callsDueNow = rows.filter((row) => row.dueAt <= now.getTime()).length
  const callsDueToday = rows.length

  const followUps = followUpRes.data ?? []
  for (const deal of followUps) {
    const contact = one(deal.crm_contacts as { full_name: string | null; phone: string | null } | Array<{ full_name: string | null; phone: string | null }> | null)
    const race = one(deal.races as { name: string | null } | Array<{ name: string | null }> | null)
    rows.push({
      id: String(deal.id),
      kind: "follow_up",
      href: adminEnquiryListPath(String(deal.id)),
      reference: String(deal.reference ?? ""),
      name: contact?.full_name?.trim() || "Lead",
      interest: race?.name?.trim() || "",
      phone: contact?.phone?.trim() || null,
      attempts: 0,
      lastOutcome: null,
      dueAt: Date.parse(String(deal.next_action_due_at)),
    })
  }

  rows.sort((a, b) => a.dueAt - b.dueAt)
  return {
    inboxNeedsReply,
    inboxRepliesThisWeek,
    callsDueNow,
    callsDueToday,
    followUpsDueNow: followUps.length,
    calls: rows.slice(0, 5),
  }
}
