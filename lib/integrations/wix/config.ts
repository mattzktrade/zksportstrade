export type WixConfig = {
  apiKey: string
  siteId: string
  webhookSecret: string | null
  agentProfileId: string | null
}

/**
 * Wix is disconnected until the website is replaced.
 * Credentials may still be in the environment; nothing may call Wix while this is true.
 */
export const WIX_INTEGRATION_DISCONNECTED = true

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

export function isWixIntegrationDisconnected(): boolean {
  return WIX_INTEGRATION_DISCONNECTED
}

export function isWixConfigured(): boolean {
  if (WIX_INTEGRATION_DISCONNECTED) return false
  return Boolean(trimEnv("WIX_API_KEY") && trimEnv("WIX_SITE_ID"))
}

export function getWixConfig(): WixConfig | null {
  if (WIX_INTEGRATION_DISCONNECTED) return null
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
