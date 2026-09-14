export const MARKETING_OUTREACH_SEQUENCE = "marketing_leads"

export const MARKETING_OUTREACH_STAGES = [1, 2, 3] as const
export type MarketingOutreachStage = (typeof MARKETING_OUTREACH_STAGES)[number]

export const MARKETING_OUTREACH_CHANNELS = ["email", "whatsapp"] as const
export type MarketingOutreachChannel = (typeof MARKETING_OUTREACH_CHANNELS)[number]

export const MARKETING_OUTREACH_STATUSES = ["active", "stopped", "completed"] as const
export type MarketingOutreachStatus = (typeof MARKETING_OUTREACH_STATUSES)[number]

export const MARKETING_OUTREACH_STOP_REASONS = [
  "replied",
  "staff",
  "not_interested",
  "stop_keyword",
  "completed",
  "no_channel",
] as const
export type MarketingOutreachStopReason = (typeof MARKETING_OUTREACH_STOP_REASONS)[number]

export type MarketingOutreachStep = {
  id: string
  sequence_key: string
  stage: MarketingOutreachStage
  delay_hours: number
  email_enabled: boolean
  email_subject: string
  email_body: string
  whatsapp_enabled: boolean
  whatsapp_body: string
  whatsapp_template_name: string
  whatsapp_template_language: string
  updated_at: string
}

export type MarketingOutreachSettings = {
  sequence_key: string
  enabled: boolean
  updated_at: string
}

export type MarketingOutreachEnrollment = {
  id: string
  deal_id: string
  account_id: string | null
  contact_id: string | null
  sequence_key: string
  status: MarketingOutreachStatus
  stop_reason: string | null
  current_stage: number
  next_stage_due_at: string | null
  first_name: string
  full_name: string
  email: string | null
  phone: string | null
  phone_digits: string | null
  interest_event: string | null
  interest_package: string | null
  interest_quantity: number | null
  created_at: string
  updated_at: string
  stopped_at: string | null
  completed_at: string | null
}

export type MarketingOutreachSend = {
  id: string
  enrollment_id: string
  deal_id: string
  stage: MarketingOutreachStage
  channel: MarketingOutreachChannel
  status: "sent" | "skipped" | "failed"
  skip_reason: string | null
  provider_message_id: string | null
  subject: string | null
  body_rendered: string | null
  error: string | null
  created_at: string
  sent_at: string | null
}

export type MarketingOutreachVars = {
  first_name: string
  full_name: string
  event: string
  package: string
  quantity: string
  company: string
}

export type MarketingOutreachSummary = {
  dealId: string
  status: MarketingOutreachStatus
  stopReason: string | null
  currentStage: number
  nextStageDueAt: string | null
  label: string
  channelsByStage: Record<MarketingOutreachStage, MarketingOutreachChannel[]>
  sends: MarketingOutreachSend[]
}
