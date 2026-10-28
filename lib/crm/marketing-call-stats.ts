import { createAdminClient } from "@/lib/supabase/admin"
import {
  callOutcomeConnected,
  isCallLostReason,
  isCallOutcome,
  type CallLostReason,
  type CallOutcome,
} from "@/lib/crm/call-outcomes"

export type MarketingCallStatsDeal = {
  id: string
  created_at: string
  owner_profile_id: string | null
  owner_name: string | null
}

export type MarketingCallStatsAttempt = {
  deal_id: string
  outcome: CallOutcome
  lost_reason: CallLostReason | null
  created_at: string
}

export type MarketingCallStatsRow = {
  ownerId: string | null
  ownerName: string
  leads: number
  called: number
  calledWithin15: number
  medianFirstCallMinutes: number | null
  connected: number
  attempts: number
  purchases: number
}

export type MarketingCallStats = {
  days: number
  total: MarketingCallStatsRow
  byOwner: MarketingCallStatsRow[]
  outcomes: Partial<Record<CallOutcome, number>>
  lostReasons: Partial<Record<CallLostReason, number>>
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function statsRow(
  ownerId: string | null,
  ownerName: string,
  deals: MarketingCallStatsDeal[],
  attemptsByDeal: Map<string, MarketingCallStatsAttempt[]>,
  purchased: Set<string>,
): MarketingCallStatsRow {
  const firstCallMinutes: number[] = []
  let called = 0
  let within15 = 0
  let connected = 0
  let attempts = 0
  let purchases = 0
  for (const deal of deals) {
    const rows = attemptsByDeal.get(deal.id) ?? []
    attempts += rows.length
    if (purchased.has(deal.id)) purchases += 1
    if (rows.length === 0) continue
    called += 1
    const first = Math.min(...rows.map((row) => Date.parse(row.created_at)))
    const minutes = Math.max(0, (first - Date.parse(deal.created_at)) / 60_000)
    firstCallMinutes.push(minutes)
    if (minutes <= 15) within15 += 1
    if (rows.some((row) => callOutcomeConnected(row.outcome))) connected += 1
  }
  const medianMinutes = median(firstCallMinutes)
  return {
    ownerId,
    ownerName,
    leads: deals.length,
    called,
    calledWithin15: within15,
    medianFirstCallMinutes: medianMinutes == null ? null : Math.round(medianMinutes),
    connected,
    attempts,
    purchases,
  }
}

export function computeMarketingCallStats(input: {
  days: number
  deals: MarketingCallStatsDeal[]
  attempts: MarketingCallStatsAttempt[]
  purchasedDealIds: string[]
}): MarketingCallStats {
  const attemptsByDeal = new Map<string, MarketingCallStatsAttempt[]>()
  const outcomes: Partial<Record<CallOutcome, number>> = {}
  const lostReasons: Partial<Record<CallLostReason, number>> = {}
  for (const row of input.attempts) {
    const list = attemptsByDeal.get(row.deal_id) ?? []
    list.push(row)
    attemptsByDeal.set(row.deal_id, list)
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1
    if (row.lost_reason) lostReasons[row.lost_reason] = (lostReasons[row.lost_reason] ?? 0) + 1
  }
  const purchased = new Set(input.purchasedDealIds)
  const owners = new Map<string, { id: string | null; name: string; deals: MarketingCallStatsDeal[] }>()
  for (const deal of input.deals) {
    const key = deal.owner_profile_id ?? "unassigned"
    const entry = owners.get(key) ?? {
      id: deal.owner_profile_id,
      name: deal.owner_profile_id ? deal.owner_name || "Unknown" : "Unassigned",
      deals: [],
    }
    entry.deals.push(deal)
    owners.set(key, entry)
  }
  return {
    days: input.days,
    total: statsRow(null, "All", input.deals, attemptsByDeal, purchased),
    byOwner: [...owners.values()]
      .map((owner) => statsRow(owner.id, owner.name, owner.deals, attemptsByDeal, purchased))
      .sort((a, b) => b.leads - a.leads),
    outcomes,
    lostReasons,
  }
}

export async function loadMarketingCallStats(days = 30): Promise<MarketingCallStats | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data: dealRows, error } = await admin
    .from("deals")
    .select("id, created_at, owner_profile_id")
    .eq("source", "marketing")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000)
  if (error) return null
  const ownerIds = [...new Set((dealRows ?? []).map((row) => row.owner_profile_id).filter(Boolean))] as string[]
  const { data: owners } = ownerIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", ownerIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> }
  const ownerName = new Map((owners ?? []).map((row) => [String(row.id), row.full_name ?? null]))
  const deals: MarketingCallStatsDeal[] = (dealRows ?? []).map((row) => ({
    id: String(row.id),
    created_at: String(row.created_at),
    owner_profile_id: (row.owner_profile_id as string | null) ?? null,
    owner_name: row.owner_profile_id ? ownerName.get(String(row.owner_profile_id)) ?? null : null,
  }))
  const ids = deals.map((deal) => deal.id)
  const attempts: MarketingCallStatsAttempt[] = []
  const purchasedDealIds: string[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const [callsRes, stoppedRes] = await Promise.all([
      admin.from("enquiry_call_attempts").select("deal_id, outcome, lost_reason, created_at").in("deal_id", slice),
      admin
        .from("marketing_outreach_enrollments")
        .select("deal_id")
        .eq("stop_reason", "purchased")
        .in("deal_id", slice),
    ])
    for (const row of callsRes.data ?? []) {
      if (!isCallOutcome(row.outcome)) continue
      attempts.push({
        deal_id: String(row.deal_id),
        outcome: row.outcome,
        lost_reason: isCallLostReason(row.lost_reason) ? row.lost_reason : null,
        created_at: String(row.created_at),
      })
    }
    for (const row of stoppedRes.data ?? []) purchasedDealIds.push(String(row.deal_id))
  }
  return computeMarketingCallStats({ days, deals, attempts, purchasedDealIds })
}
