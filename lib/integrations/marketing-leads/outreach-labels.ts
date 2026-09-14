import type {
  MarketingOutreachChannel,
  MarketingOutreachSend,
  MarketingOutreachStage,
  MarketingOutreachStatus,
  MarketingOutreachStopReason,
  MarketingOutreachSummary,
} from "@/lib/integrations/marketing-leads/outreach-types"

const STOP_LABELS: Record<MarketingOutreachStopReason, string> = {
  replied: "They replied — follow-up stopped",
  staff: "Staff took over — follow-up stopped",
  not_interested: "Marked not interested — follow-up stopped",
  stop_keyword: "They asked to stop — follow-up stopped",
  completed: "All 3 stages sent",
  no_channel: "No email or phone to send to",
}

export function marketingOutreachStopLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return STOP_LABELS[reason as MarketingOutreachStopReason] ?? "Follow-up stopped"
}

function channelLabel(channel: MarketingOutreachChannel): string {
  return channel === "whatsapp" ? "WhatsApp" : "email"
}

function sentChannelsForStage(
  sends: MarketingOutreachSend[],
  stage: MarketingOutreachStage,
): MarketingOutreachChannel[] {
  return sends
    .filter((row) => row.stage === stage && row.status === "sent")
    .map((row) => row.channel)
}

function highestSentStage(sends: MarketingOutreachSend[]): MarketingOutreachStage | null {
  let highest: MarketingOutreachStage | null = null
  for (const row of sends) {
    if (row.status !== "sent") continue
    if (row.stage === 1 || row.stage === 2 || row.stage === 3) {
      if (highest == null || row.stage > highest) highest = row.stage
    }
  }
  return highest
}

export function marketingOutreachLabel(input: {
  status: MarketingOutreachStatus
  stopReason: string | null
  currentStage: number
  nextStageDueAt: string | null
  sends: MarketingOutreachSend[]
}): string {
  if (input.status === "stopped") {
    return marketingOutreachStopLabel(input.stopReason) ?? "Follow-up stopped"
  }
  const latest = highestSentStage(input.sends)
  if (input.status === "completed") {
    const stage = latest ?? 3
    const sent = sentChannelsForStage(input.sends, stage)
    if (sent.length === 0) return "Stage 3 done"
    return `Stage ${stage} · ${sent.map(channelLabel).join(" + ")} sent`
  }
  if (latest) {
    const sent = sentChannelsForStage(input.sends, latest)
    return `Stage ${latest} · ${sent.map(channelLabel).join(" + ")} sent`
  }
  return "Stage 1 due"
}

export const RETRYABLE_OUTREACH_SKIP_REASONS = [
  "email_not_configured",
  "whatsapp_not_configured",
  "template_missing",
] as const

export type OutreachChannelOutcome = {
  status: "sent" | "skipped" | "failed"
  skipReason?: string | null
  unchanged?: boolean
}

export function outreachChannelIsRetryable(outcome: OutreachChannelOutcome): boolean {
  if (outcome.status === "failed") return true
  if (outcome.status !== "skipped" || !outcome.skipReason) return false
  return (RETRYABLE_OUTREACH_SKIP_REASONS as readonly string[]).includes(outcome.skipReason)
}

export function shouldAdvanceOutreachStage(email: OutreachChannelOutcome, whatsapp: OutreachChannelOutcome):
  | "advance"
  | "hold"
  | "no_channel" {
  if (outreachChannelIsRetryable(email) || outreachChannelIsRetryable(whatsapp)) return "hold"
  if (email.status === "sent" || whatsapp.status === "sent") return "advance"
  return "no_channel"
}

export type EnquiryOutreachBadge = {
  dealId: string
  status: MarketingOutreachStatus
  stopReason: string | null
  currentStage: number
  label: string
  idle?: boolean
}

export function toEnquiryOutreachBadge(summary: MarketingOutreachSummary): EnquiryOutreachBadge {
  return {
    dealId: summary.dealId,
    status: summary.status,
    stopReason: summary.stopReason,
    currentStage: summary.currentStage,
    label: summary.label,
  }
}

export function marketingFollowUpForEnquiry(input: {
  dealId: string
  source: string
  outreach?: EnquiryOutreachBadge
  sequenceEnabled: boolean
}): EnquiryOutreachBadge | undefined {
  if (input.outreach) return input.outreach
  if (input.source !== "marketing") return undefined
  return {
    dealId: input.dealId,
    status: "stopped",
    stopReason: null,
    currentStage: 0,
    idle: true,
    label: input.sequenceEnabled ? "Follow-up not started" : "Follow-up off",
  }
}

export function toMarketingOutreachSummary(
  dealId: string,
  enrollment: {
    status: MarketingOutreachStatus
    stop_reason: string | null
    current_stage: number
    next_stage_due_at: string | null
  },
  sends: MarketingOutreachSend[],
): MarketingOutreachSummary {
  const channelsByStage = {
    1: sentChannelsForStage(sends, 1),
    2: sentChannelsForStage(sends, 2),
    3: sentChannelsForStage(sends, 3),
  }
  return {
    dealId,
    status: enrollment.status,
    stopReason: enrollment.stop_reason,
    currentStage: enrollment.current_stage,
    nextStageDueAt: enrollment.next_stage_due_at,
    label: marketingOutreachLabel({
      status: enrollment.status,
      stopReason: enrollment.stop_reason,
      currentStage: enrollment.current_stage,
      nextStageDueAt: enrollment.next_stage_due_at,
      sends,
    }),
    channelsByStage,
    sends,
  }
}

export function isOutreachStopKeyword(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (/^(stop|unsubscribe|opt out|opt-out|cancel)$/i.test(normalized)) return true
  return /\b(stop|unsubscribe|opt out|opt-out|not interested|no thanks|don't contact|do not contact)\b/i.test(
    normalized,
  )
}

export function phonesMatchForOutreach(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? "").replace(/\D/g, "")
  const b = (right ?? "").replace(/\D/g, "")
  if (!a || !b) return false
  if (a === b) return true
  const short = a.length < b.length ? a : b
  const long = a.length < b.length ? b : a
  return short.length >= 8 && long.endsWith(short)
}

export function missingOutreachRelation(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ""
  return error.code === "42P01" || /does not exist|schema cache/i.test(message)
}
