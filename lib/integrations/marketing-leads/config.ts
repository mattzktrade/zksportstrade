export type MarketingLeadConfig = {
  webhookSecret: string
}

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export function getMarketingLeadConfig(): MarketingLeadConfig | null {
  const webhookSecret = trimEnv("MARKETING_LEAD_WEBHOOK_SECRET")
  if (!webhookSecret) return null
  return { webhookSecret }
}

export function isMarketingLeadWebhookConfigured(): boolean {
  return Boolean(getMarketingLeadConfig())
}

export const MARKETING_LEAD_WEBHOOK_PATH = "/api/webhooks/marketing-lead"
export const MARKETING_LEAD_PRODUCTION_URL = `https://zk-sports.trade${MARKETING_LEAD_WEBHOOK_PATH}`
