export const ASSISTANT_CHANNELS = ["whatsapp", "email", "cms"] as const
export type AssistantChannel = (typeof ASSISTANT_CHANNELS)[number]

export const ASSISTANT_STATUSES = ["ai_active", "human_takeover", "needs_review", "closed"] as const
export type AssistantStatus = (typeof ASSISTANT_STATUSES)[number]

export const ASSISTANT_IDENTITY = ["unique", "new", "ambiguous", "unknown"] as const
export type AssistantIdentityStatus = (typeof ASSISTANT_IDENTITY)[number]

export const ASSISTANT_DECISIONS = [
  "sent",
  "drafted",
  "escalated",
  "skipped",
  "prepare_booking_form",
  "source",
] as const
export type AssistantDecision = (typeof ASSISTANT_DECISIONS)[number]

export type AssistantSettings = {
  autoSendEnabled: boolean
  killSwitch: boolean
  allowPublishedTradePrices: boolean
  notifyEmails: string[]
  debounceSeconds: number
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  autoSendEnabled: false,
  killSwitch: false,
  allowPublishedTradePrices: false,
  notifyEmails: ["matt@zk-sports.com"],
  debounceSeconds: 20,
}

export type AssistantConversation = {
  id: string
  channel: AssistantChannel
  status: AssistantStatus
  identityStatus: AssistantIdentityStatus
  phoneDigits: string | null
  email: string | null
  displayName: string
  ourNumber: string | null
  accountId: string | null
  contactId: string | null
  dealId: string | null
  ownerProfileId: string | null
  runAfterAt: string | null
  lastClientMessageAt: string | null
  lastOutboundAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type AssistantMessage = {
  id: string
  conversationId: string
  direction: "inbound" | "outbound"
  sentBy: "client" | "ai" | "staff"
  channel: AssistantChannel
  body: string
  mediaType: string | null
  providerMessageId: string | null
  processedAt: string | null
  createdAt: string
}

export type AssistantDraft = {
  id: string
  conversationId: string
  runId: string | null
  body: string
  status: "pending" | "sent" | "discarded"
  intent: string
  createdAt: string
}

export type AssistantToolTrace = {
  name: string
  arguments: Record<string, unknown>
  result: unknown
}

export type AssistantLlmResult = {
  reply: string
  confidence: number
  intent: AssistantIntent
  packageIds: string[]
  needsHuman: boolean
  reason: string
  toolTrace: AssistantToolTrace[]
  model: string
}

export const ASSISTANT_INTENTS = [
  "answer",
  "quote",
  "source",
  "book",
  "portal",
  "unclear",
] as const
export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number]

export type ClientMessageClass = {
  wantsBooking: boolean
  wantsPrice: boolean
  sensitive: boolean
  portalHint: boolean
  mediaOnly: boolean
}

export type PackageResolution = "none" | "unique" | "ambiguous"

export type PolicyInput = {
  killSwitch: boolean
  autoSendEnabled: boolean
  llmConfigured: boolean
  envKillSwitch: boolean
  confidence: number
  identity: AssistantIdentityStatus
  packageResolution: PackageResolution
  factsMissing: boolean
  toolFailed: boolean
  wantsPriceCommit: boolean
  allowPublishedTradePrices: boolean
  wantsBooking: boolean
  dealHasPricedLines: boolean
  dealHasPackage: boolean
  dealHasQuantity: boolean
  sensitiveTopic: boolean
  humanTakeover: boolean
  withinCustomerWindow: boolean
  stockStatus: "in_stock" | "out" | "unknown" | "na"
  mediaOnly: boolean
  intent: AssistantIntent
  needsHuman: boolean
}

export type PolicyResult = {
  decision: AssistantDecision
  autoSend: boolean
  notifyStaff: boolean
  reason: string
}

export const ASSISTANT_INBOX_HREF = "/admin/assistant"
export const ASSISTANT_REVIEW_HREF = "/admin/assistant?status=needs_review"
export const ASSISTANT_READINESS_HREF = "/admin/assistant/readiness"
export const ASSISTANT_KNOWLEDGE_HREF = "/admin/assistant/knowledge"

export const WHATSAPP_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000
export const ASSISTANT_MIN_CONFIDENCE = 0.78
