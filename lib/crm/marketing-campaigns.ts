import { createAdminClient } from "@/lib/supabase/admin"
import { listCallAttemptsForDeals } from "@/lib/crm/call-attempts-store"
import { enquiryCallDueAt, enquiryNeedsCall, type EnquiryCallSummary } from "@/lib/crm/call-outcomes"
import { enquiryCrmStageFromDeal } from "@/lib/crm/deal-pipeline"
import { inboxWaitState } from "@/lib/assistant/inbox"

export const UNMATCHED_CAMPAIGN_ID = "unmatched"
export const CAMPAIGNS_HREF = "/admin/marketing"

const BOOKING_FORM_STAGES = new Set([
  "awaiting_booking_form_send",
  "booking_form_sent",
  "awaiting_client_signature",
  "awaiting_zk_signature",
  "form_expired",
])
const BOOKED_STAGES = new Set([
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
])

export type CampaignLead = {
  id: string
  created_at: string
  stage: string
  enquiry_stage: string | null
  next_action_due_at: string | null
  race_id: string | null
  owner_profile_id: string | null
  owner_name: string | null
  enquiry_replied_at: string | null
  ad_name: string | null
  calls?: EnquiryCallSummary
  sequence?: { status: string; stop_reason: string | null }
  conversation?: { clientReplied: boolean; needsOurReply: boolean }
}

export type CampaignCounts = {
  leads: number
  newThisWeek: number
  responded: number
  repliedByMessage: number
  spokeOnPhone: number
  called: number
  calledWithin15: number
  medianFirstCallMinutes: number | null
  waitingForOurReply: number
  callsDueNow: number
  inSequence: number
  bookingForm: number
  booked: number
  notInterested: number
}

export type CampaignBreakdownRow = { key: string; label: string } & Pick<
  CampaignCounts,
  "leads" | "responded" | "called" | "booked"
>

export type CampaignReport = {
  id: string
  name: string
  eventDate: string | null
  firstLeadAt: string
  lastLeadAt: string
  counts: CampaignCounts
  byAd: CampaignBreakdownRow[]
  byOwner: CampaignBreakdownRow[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
}

export function leadReplied(lead: CampaignLead): boolean {
  return Boolean(lead.enquiry_replied_at || lead.conversation?.clientReplied || lead.sequence?.stop_reason === "replied")
}

export function leadSpokeOnPhone(lead: CampaignLead): boolean {
  return Boolean(lead.calls?.connected)
}

export function leadBooked(lead: CampaignLead): boolean {
  return (
    BOOKED_STAGES.has(lead.stage) ||
    lead.sequence?.stop_reason === "purchased" ||
    lead.calls?.lastOutcome === "connected_booked"
  )
}

export function leadNotInterested(lead: CampaignLead): boolean {
  if (leadBooked(lead)) return false
  if (lead.stage === "closed_lost" || lead.stage === "cancelled") return true
  if (enquiryCrmStageFromDeal(lead) === "not_interested") return true
  return lead.sequence?.stop_reason === "not_interested" || lead.sequence?.stop_reason === "do_not_contact"
}

export function countCampaignLeads(leads: CampaignLead[], now = new Date()): CampaignCounts {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const firstCallMinutes: number[] = []
  const counts: CampaignCounts = {
    leads: leads.length,
    newThisWeek: 0,
    responded: 0,
    repliedByMessage: 0,
    spokeOnPhone: 0,
    called: 0,
    calledWithin15: 0,
    medianFirstCallMinutes: null,
    waitingForOurReply: 0,
    callsDueNow: 0,
    inSequence: 0,
    bookingForm: 0,
    booked: 0,
    notInterested: 0,
  }
  for (const lead of leads) {
    if (Date.parse(lead.created_at) >= weekAgo) counts.newThisWeek += 1
    const replied = leadReplied(lead)
    const spoke = leadSpokeOnPhone(lead)
    if (replied) counts.repliedByMessage += 1
    if (spoke) counts.spokeOnPhone += 1
    if (replied || spoke) counts.responded += 1
    if (lead.calls && lead.calls.attempts > 0) {
      counts.called += 1
      const first = lead.calls.firstCalledAt ? Date.parse(lead.calls.firstCalledAt) : Number.NaN
      if (Number.isFinite(first)) {
        const minutes = Math.max(0, (first - Date.parse(lead.created_at)) / 60_000)
        firstCallMinutes.push(minutes)
        if (minutes <= 15) counts.calledWithin15 += 1
      }
    }
    if (lead.conversation?.needsOurReply) counts.waitingForOurReply += 1
    const callDeal = { ...lead, source: "marketing" }
    if (enquiryNeedsCall(callDeal, lead.calls, now) && enquiryCallDueAt(callDeal, lead.calls) <= now.getTime()) {
      counts.callsDueNow += 1
    }
    if (lead.sequence?.status === "active") counts.inSequence += 1
    if (leadBooked(lead)) counts.booked += 1
    else if (BOOKING_FORM_STAGES.has(lead.stage)) counts.bookingForm += 1
    if (leadNotInterested(lead)) counts.notInterested += 1
  }
  counts.medianFirstCallMinutes = median(firstCallMinutes)
  return counts
}

function breakdown(
  leads: CampaignLead[],
  keyOf: (lead: CampaignLead) => { key: string; label: string },
  now: Date,
): CampaignBreakdownRow[] {
  const groups = new Map<string, { label: string; leads: CampaignLead[] }>()
  for (const lead of leads) {
    const { key, label } = keyOf(lead)
    const entry = groups.get(key) ?? { label, leads: [] }
    entry.leads.push(lead)
    groups.set(key, entry)
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const counts = countCampaignLeads(group.leads, now)
      return {
        key,
        label: group.label,
        leads: counts.leads,
        responded: counts.responded,
        called: counts.called,
        booked: counts.booked,
      }
    })
    .sort((a, b) => b.leads - a.leads)
}

export function buildCampaignReports(
  leads: CampaignLead[],
  races: Map<string, { name: string; eventDate: string | null }>,
  now = new Date(),
): CampaignReport[] {
  const groups = new Map<string, CampaignLead[]>()
  for (const lead of leads) {
    const key = lead.race_id && races.has(lead.race_id) ? lead.race_id : UNMATCHED_CAMPAIGN_ID
    const list = groups.get(key) ?? []
    list.push(lead)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .map(([id, group]) => {
      const times = group.map((lead) => lead.created_at).sort()
      const race = races.get(id)
      return {
        id,
        name: race?.name ?? "No event matched",
        eventDate: race?.eventDate ?? null,
        firstLeadAt: times[0],
        lastLeadAt: times[times.length - 1],
        counts: countCampaignLeads(group, now),
        byAd: breakdown(
          group,
          (lead) => ({ key: lead.ad_name || "-", label: lead.ad_name || "Ad name not sent" }),
          now,
        ),
        byOwner: breakdown(
          group,
          (lead) => ({
            key: lead.owner_profile_id || "unassigned",
            label: lead.owner_profile_id ? lead.owner_name || "Unknown" : "Unassigned",
          }),
          now,
        ),
      }
    })
    .sort((a, b) => {
      if (a.id === UNMATCHED_CAMPAIGN_ID) return 1
      if (b.id === UNMATCHED_CAMPAIGN_ID) return -1
      return b.lastLeadAt.localeCompare(a.lastLeadAt)
    })
}

function chunks<T>(values: T[], size = 80): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function adNameFrom(campaign: unknown): string | null {
  if (!campaign || typeof campaign !== "object") return null
  const row = campaign as Record<string, unknown>
  const name = typeof row.name === "string" ? row.name.trim() : ""
  const adset = typeof row.adsetName === "string" ? row.adsetName.trim() : ""
  if (name && adset && adset !== name) return `${name} · ${adset}`
  return name || adset || null
}

export async function loadCampaignReports(now = new Date()): Promise<CampaignReport[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: dealRows, error } = await admin
    .from("deals")
    .select("id, created_at, stage, enquiry_stage, next_action_due_at, race_id, owner_profile_id, enquiry_replied_at")
    .eq("source", "marketing")
    .order("created_at", { ascending: false })
    .limit(5000)
  if (error) {
    console.error("[campaigns]", error.message)
    return []
  }
  const deals = dealRows ?? []
  const ids = deals.map((row) => String(row.id))
  const raceIds = [...new Set(deals.map((row) => row.race_id).filter(Boolean))] as string[]
  const ownerIds = [...new Set(deals.map((row) => row.owner_profile_id).filter(Boolean))] as string[]

  const [calls, raceRows, ownerRows, sequenceRows, conversationRows, ingestRows] = await Promise.all([
    listCallAttemptsForDeals(ids),
    raceIds.length ? admin.from("races").select("id, name, event_date").in("id", raceIds) : Promise.resolve({ data: [] }),
    ownerIds.length ? admin.from("profiles").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [] }),
    Promise.all(
      chunks(ids).map((slice) =>
        admin.from("marketing_outreach_enrollments").select("deal_id, status, stop_reason").in("deal_id", slice),
      ),
    ),
    Promise.all(
      chunks(ids).map((slice) =>
        admin
          .from("assistant_conversations")
          .select("deal_id, status, last_client_message_at, last_outbound_at")
          .in("deal_id", slice),
      ),
    ),
    Promise.all(
      chunks(ids).map((slice) =>
        admin.from("marketing_lead_ingest").select("deal_id, campaign:payload->campaign").in("deal_id", slice),
      ),
    ),
  ])

  const races = new Map(
    ((raceRows.data ?? []) as Array<{ id: string; name: string | null; event_date: string | null }>).map((row) => [
      String(row.id),
      { name: String(row.name ?? "Event"), eventDate: row.event_date ?? null },
    ]),
  )
  const owners = new Map(
    ((ownerRows.data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [String(row.id), row.full_name]),
  )
  const sequences = new Map<string, { status: string; stop_reason: string | null }>()
  for (const result of sequenceRows) {
    for (const row of result.data ?? []) {
      sequences.set(String(row.deal_id), { status: String(row.status), stop_reason: row.stop_reason ?? null })
    }
  }
  const conversations = new Map<string, { clientReplied: boolean; needsOurReply: boolean }>()
  for (const result of conversationRows) {
    for (const row of result.data ?? []) {
      const key = String(row.deal_id)
      const wait = inboxWaitState({
        lastClientMessageAt: row.last_client_message_at ?? null,
        lastOutboundAt: row.last_outbound_at ?? null,
      })
      const prev = conversations.get(key)
      conversations.set(key, {
        clientReplied: Boolean(prev?.clientReplied || row.last_client_message_at),
        needsOurReply: Boolean(prev?.needsOurReply || (row.status !== "closed" && wait === "replied")),
      })
    }
  }
  const adNames = new Map<string, string | null>()
  for (const result of ingestRows) {
    for (const row of (result.data ?? []) as Array<{ deal_id: string | null; campaign: unknown }>) {
      if (row.deal_id) adNames.set(String(row.deal_id), adNameFrom(row.campaign))
    }
  }

  const leads: CampaignLead[] = deals.map((row) => {
    const id = String(row.id)
    return {
      id,
      created_at: String(row.created_at),
      stage: String(row.stage),
      enquiry_stage: row.enquiry_stage ?? null,
      next_action_due_at: row.next_action_due_at ?? null,
      race_id: row.race_id ?? null,
      owner_profile_id: row.owner_profile_id ?? null,
      owner_name: row.owner_profile_id ? owners.get(String(row.owner_profile_id)) ?? null : null,
      enquiry_replied_at: row.enquiry_replied_at ?? null,
      ad_name: adNames.get(id) ?? null,
      calls: calls[id],
      sequence: sequences.get(id),
      conversation: conversations.get(id),
    }
  })
  return buildCampaignReports(leads, races, now)
}
