import { getResendApiKey, getResendFromAddress, stripSurroundingQuotes } from "@/lib/email/config"

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export const MARKETING_OUTREACH_WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp"
export const MARKETING_OUTREACH_EMAIL_REPLY_WEBHOOK_PATH = "/api/webhooks/marketing-outreach-email"
export const MARKETING_OUTREACH_WHATSAPP_WEBHOOK_URL = `https://zk-sports.trade${MARKETING_OUTREACH_WHATSAPP_WEBHOOK_PATH}`
export const MARKETING_OUTREACH_EMAIL_REPLY_WEBHOOK_URL = `https://zk-sports.trade${MARKETING_OUTREACH_EMAIL_REPLY_WEBHOOK_PATH}`

export type WhatsAppCloudConfig = {
  token: string
  phoneNumberId: string
  webhookVerifyToken: string
  appSecret: string | null
}

export function getWhatsAppCloudConfig(): WhatsAppCloudConfig | null {
  const token = trimEnv("WHATSAPP_TOKEN") || trimEnv("WHATSAPP_CLOUD_TOKEN")
  const phoneNumberId = trimEnv("WHATSAPP_PHONE_NUMBER_ID")
  const webhookVerifyToken = trimEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
  if (!token || !phoneNumberId) return null
  return {
    token,
    phoneNumberId,
    webhookVerifyToken: webhookVerifyToken || "",
    appSecret: trimEnv("WHATSAPP_APP_SECRET") || null,
  }
}

export function isWhatsAppCloudConfigured(): boolean {
  return getWhatsAppCloudConfig() != null
}

export function getWhatsAppWebhookVerifyToken(): string | undefined {
  return trimEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
}

export function getWhatsAppAppSecret(): string | undefined {
  return trimEnv("WHATSAPP_APP_SECRET")
}

export function isMarketingOutreachEmailConfigured(): boolean {
  if (!getResendApiKey()) return false
  const dedicated = stripSurroundingQuotes(process.env.MARKETING_OUTREACH_FROM?.trim() ?? "")
  return Boolean(dedicated || getResendFromAddress())
}
