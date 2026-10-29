import { CALL_OUTCOME_LABELS, enquiryCallDueAt, enquiryNeedsCall, type EnquiryCallSummary } from "@/lib/crm/call-outcomes"
import { DEFAULT_LEAD_TIMEZONE, localDayAt, zonedParts } from "@/lib/crm/lead-timezone"

/** Digest goes out once a day from this hour, Dubai time. */
export const SALES_DIGEST_HOUR = 9

export type DigestDeal = {
  id: string
  reference: string
  stage: string
  enquiry_stage: string | null
  source: string
  created_at: string
  next_action: string | null
  next_action_due_at: string | null
  owner_profile_id: string | null
  name: string
  phone: string | null
  interest: string
}

export type DigestItem = {
  dealId: string
  reference: string
  name: string
  phone: string | null
  interest: string
  task: string
  dueAt: number
}

export type SalesDigest = {
  unclaimed: DigestItem[]
  calls: DigestItem[]
  nextSteps: DigestItem[]
  followUps: DigestItem[]
}

export function digestDateKey(now: Date): string {
  const p = zonedParts(now, DEFAULT_LEAD_TIMEZONE)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

export function salesDigestDue(now: Date): boolean {
  return zonedParts(now, DEFAULT_LEAD_TIMEZONE).hour >= SALES_DIGEST_HOUR
}

export function digestIsEmpty(digest: SalesDigest): boolean {
  return !digest.unclaimed.length && !digest.calls.length && !digest.nextSteps.length && !digest.followUps.length
}

function item(deal: DigestDeal, task: string, dueAt: number): DigestItem {
  return {
    dealId: deal.id,
    reference: deal.reference,
    name: deal.name,
    phone: deal.phone,
    interest: deal.interest,
    task,
    dueAt,
  }
}

/**
 * One person's day: their calls, callbacks and follow-ups due by the end of
 * today (Dubai), plus unclaimed new leads when `includeUnclaimed` is set.
 */
export function buildSalesDigest(input: {
  deals: DigestDeal[]
  calls: Record<string, EnquiryCallSummary>
  ownerProfileId: string | null
  includeUnclaimed: boolean
  now: Date
}): SalesDigest {
  const endOfDay = localDayAt(input.now, DEFAULT_LEAD_TIMEZONE, 1, 0).getTime()
  const digest: SalesDigest = { unclaimed: [], calls: [], nextSteps: [], followUps: [] }
  for (const deal of input.deals) {
    if (deal.source !== "marketing") continue
    const mine = Boolean(input.ownerProfileId && deal.owner_profile_id === input.ownerProfileId)
    const unclaimed = !deal.owner_profile_id
    if (!mine && !(unclaimed && input.includeUnclaimed)) continue
    const summary = input.calls[deal.id]
    const due = deal.next_action_due_at ? Date.parse(deal.next_action_due_at) : Number.NaN

    if (deal.enquiry_stage === "new") {
      if (!enquiryNeedsCall(deal, summary)) continue
      const callDue = enquiryCallDueAt(deal, summary)
      if (callDue >= endOfDay) continue
      const attempts = summary?.attempts ?? 0
      const last = summary?.lastOutcome ? `, last: ${CALL_OUTCOME_LABELS[summary.lastOutcome]}` : ""
      const task = attempts === 0 ? "First call" : `Call ${attempts + 1}${last}`
      if (unclaimed) digest.unclaimed.push(item(deal, task, callDue))
      else digest.calls.push(item(deal, task, callDue))
      continue
    }
    if (unclaimed && !input.includeUnclaimed) continue
    if (!Number.isFinite(due) || due >= endOfDay) continue
    if (deal.enquiry_stage === "contacted") {
      digest.nextSteps.push(item(deal, deal.next_action?.trim() || "Next step", due))
    } else if (deal.enquiry_stage === "follow_up") {
      digest.followUps.push(item(deal, "Follow up", due))
    }
  }
  for (const list of Object.values(digest)) list.sort((a, b) => a.dueAt - b.dueAt)
  return digest
}
