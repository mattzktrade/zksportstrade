import { enquiryCrmStageFromDeal, isOpenEnquiry, type EnquiryCrmStage } from "@/lib/crm/deal-pipeline"
import { localDayAt, nextContactWindowTime } from "@/lib/crm/lead-timezone"
import type { MarketingOutreachStopReason } from "@/lib/integrations/marketing-leads/outreach-types"

export const CALL_OUTCOMES = [
  "connected_interested",
  "connected_callback",
  "connected_not_interested",
  "connected_booked",
  "no_answer",
  "voicemail",
  "busy",
  "wrong_number",
  "do_not_contact",
  "unqualified",
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected_interested: "Spoke: interested",
  connected_callback: "Spoke: call back later",
  connected_not_interested: "Spoke: not interested",
  connected_booked: "Spoke: already booked",
  no_answer: "No answer",
  voicemail: "Voicemail left",
  busy: "Busy / declined",
  wrong_number: "Wrong number",
  do_not_contact: "Do not contact",
  unqualified: "Not a real lead",
}

export const CALL_LOST_REASONS = ["price", "dates", "other_provider", "browsing", "booked_direct", "other"] as const
export type CallLostReason = (typeof CALL_LOST_REASONS)[number]

export const CALL_LOST_REASON_LABELS: Record<CallLostReason, string> = {
  price: "Price",
  dates: "Dates",
  other_provider: "Chose another provider",
  browsing: "Just browsing",
  booked_direct: "Booked direct",
  other: "Other",
}

/** After this many unanswered attempts, with nobody ever reaching them, the lead closes as Not interested. */
export const MAX_CALL_ATTEMPTS = 5

export function isCallOutcome(value: string | null | undefined): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value ?? "")
}

export function isCallLostReason(value: string | null | undefined): value is CallLostReason {
  return (CALL_LOST_REASONS as readonly string[]).includes(value ?? "")
}

export function callOutcomeConnected(outcome: CallOutcome): boolean {
  return outcome.startsWith("connected_")
}

export function callOutcomeUnanswered(outcome: CallOutcome): boolean {
  return outcome === "no_answer" || outcome === "voicemail" || outcome === "busy"
}

export function callOutcomeNeedsLostReason(outcome: CallOutcome): boolean {
  return outcome === "connected_not_interested"
}

export function callOutcomeNeedsCallback(outcome: CallOutcome): boolean {
  return outcome === "connected_callback"
}

export type CallOutcomePlan = {
  /** Enquiry stage to move to, or null to leave the stage alone. */
  enquiryStage: EnquiryCrmStage | null
  temperature: "warm" | "cold" | null
  /** Stop the marketing sequence with this reason, or null to let it continue. */
  stopReason: MarketingOutreachStopReason | null
  blockWhatsApp: boolean
  nextAction: string
  nextActionDueAt: Date | null
  /** True when this attempt used up the cadence without anyone answering. */
  noResponse: boolean
}

/** Cadence after an unanswered attempt: +3h, next evening, +2 days morning, +3 days afternoon. */
export function nextCallDueAfterUnanswered(attemptNo: number, now: Date, timeZone: string): Date | null {
  switch (attemptNo) {
    case 1:
      return nextContactWindowTime(new Date(now.getTime() + 3 * 60 * 60 * 1000), timeZone)
    case 2:
      return localDayAt(now, timeZone, 1, 18)
    case 3:
      return localDayAt(now, timeZone, 2, 10)
    case 4:
      return localDayAt(now, timeZone, 3, 14)
    default:
      return null
  }
}

export const NO_RESPONSE_CLOSED_SUMMARY = "Closed as Not interested: no answer after 5 calls"

export function planCallOutcome(input: {
  outcome: CallOutcome
  attemptNo: number
  now: Date
  timeZone: string
  callbackAt?: Date | null
  /** Someone has already spoken to this lead on an earlier call. */
  spokeBefore?: boolean
}): CallOutcomePlan {
  const { outcome, attemptNo, now, timeZone } = input
  const base: CallOutcomePlan = {
    enquiryStage: null,
    temperature: null,
    stopReason: null,
    blockWhatsApp: false,
    nextAction: "",
    nextActionDueAt: null,
    noResponse: false,
  }
  switch (outcome) {
    case "connected_interested":
      return {
        ...base,
        enquiryStage: "contacted",
        temperature: "warm",
        stopReason: "spoke",
        nextAction: "Send booking link / form",
        nextActionDueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      }
    case "connected_callback":
      return {
        ...base,
        enquiryStage: "contacted",
        temperature: "warm",
        stopReason: "spoke",
        nextAction: "Call back",
        nextActionDueAt: input.callbackAt ?? localDayAt(now, timeZone, 1, 10),
      }
    case "connected_not_interested":
      return { ...base, enquiryStage: "not_interested", stopReason: "not_interested", nextAction: "No further action" }
    case "connected_booked":
      return { ...base, enquiryStage: "not_interested", stopReason: "purchased", nextAction: "No further action" }
    case "do_not_contact":
      return { ...base, enquiryStage: "not_interested", stopReason: "do_not_contact", nextAction: "No further action" }
    case "unqualified":
      return { ...base, enquiryStage: "not_interested", stopReason: "not_interested", nextAction: "No further action" }
    case "wrong_number":
      return {
        ...base,
        blockWhatsApp: true,
        nextAction: "Find a working number",
        nextActionDueAt: now,
      }
    case "no_answer":
    case "voicemail":
    case "busy": {
      if (input.spokeBefore) {
        return { ...base, nextAction: "Try them again", nextActionDueAt: localDayAt(now, timeZone, 1, 10) }
      }
      // The automated messages keep running so the last one ("should we close your enquiry?") still goes out.
      if (attemptNo >= MAX_CALL_ATTEMPTS) {
        return {
          ...base,
          enquiryStage: "not_interested",
          temperature: "cold",
          nextAction: "No further action",
          noResponse: true,
        }
      }
      return {
        ...base,
        nextAction: `Call attempt ${attemptNo + 1}`,
        nextActionDueAt: nextCallDueAfterUnanswered(attemptNo, now, timeZone),
      }
    }
  }
}

export type EnquiryCallAttempt = {
  id: string
  deal_id: string
  attempt_no: number
  outcome: CallOutcome
  lost_reason: string | null
  notes: string | null
  callback_at: string | null
  actor_profile_id: string | null
  actor_name?: string | null
  created_at: string
}

export type EnquiryCallSummary = {
  attempts: number
  lastOutcome: CallOutcome | null
  lastCalledAt: string | null
  firstCalledAt: string | null
  connected: boolean
  history: EnquiryCallAttempt[]
}

type CallListDeal = {
  source: string
  stage: string
  enquiry_stage?: string | null
  created_at: string
  next_action_due_at: string | null
}

/** Marketing leads nobody has spoken to yet, with calls left in the cadence. */
export function enquiryNeedsCall(deal: CallListDeal, summary: EnquiryCallSummary | undefined): boolean {
  if (deal.source !== "marketing") return false
  if (!isOpenEnquiry(deal)) return false
  if (enquiryCrmStageFromDeal(deal) !== "new") return false
  if (summary?.connected) return false
  return (summary?.attempts ?? 0) < MAX_CALL_ATTEMPTS
}

/** First call is due five minutes after the lead lands; later calls follow the logged next step. */
export function enquiryCallDueAt(deal: CallListDeal, summary: EnquiryCallSummary | undefined): number {
  if (!summary || summary.attempts === 0) return Date.parse(deal.created_at) + 5 * 60 * 1000
  const due = deal.next_action_due_at ? Date.parse(deal.next_action_due_at) : Number.NaN
  return Number.isFinite(due) ? due : Number.POSITIVE_INFINITY
}

export function summarizeCallAttempts(rows: EnquiryCallAttempt[]): EnquiryCallSummary {
  const history = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const last = history[0] ?? null
  const first = history[history.length - 1] ?? null
  return {
    attempts: history.length,
    lastOutcome: last?.outcome ?? null,
    lastCalledAt: last?.created_at ?? null,
    firstCalledAt: first?.created_at ?? null,
    connected: history.some((row) => callOutcomeConnected(row.outcome)),
    history,
  }
}
