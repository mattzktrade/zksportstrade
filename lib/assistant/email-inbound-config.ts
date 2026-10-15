export const INBOUND_EMAIL_WEBHOOK_PATH = "/api/webhooks/assistant-email"
export const INBOUND_EMAIL_WEBHOOK_URL = `https://zk-sports.trade${INBOUND_EMAIL_WEBHOOK_PATH}`

export function getInboundEmailWebhookSecret(): string | null {
  return (
    process.env.ASSISTANT_EMAIL_WEBHOOK_SECRET?.trim() ||
    process.env.MARKETING_OUTREACH_EMAIL_WEBHOOK_SECRET?.trim() ||
    null
  )
}

export function isInboundEmailWebhookConfigured(): boolean {
  return Boolean(getInboundEmailWebhookSecret())
}
