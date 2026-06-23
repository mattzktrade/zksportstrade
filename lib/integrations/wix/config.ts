export type WixConfig = {
  apiKey: string
  siteId: string
  webhookSecret: string | null
  agentProfileId: string | null
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

export function isWixConfigured(): boolean {
  return Boolean(trimEnv("WIX_API_KEY") && trimEnv("WIX_SITE_ID"))
}

export function getWixConfig(): WixConfig | null {
  const apiKey = trimEnv("WIX_API_KEY")
  const siteId = trimEnv("WIX_SITE_ID")
  if (!apiKey || !siteId) return null

  return {
    apiKey,
    siteId,
    webhookSecret: trimEnv("WIX_WEBHOOK_SECRET") ?? null,
    agentProfileId: trimEnv("WIX_AGENT_PROFILE_ID") ?? null,
  }
}
