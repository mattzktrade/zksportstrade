export type XeroCredentials = {
  clientId: string
  clientSecret: string
  webhookKey: string | null
}

export type XeroConfig = XeroCredentials & {
  /** Required for OAuth connect/callback only — not for API calls or token refresh. */
  redirectUri: string
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

/** Client ID + secret (and optional webhook key). Safe to use from background jobs. */
export function getXeroCredentials(): XeroCredentials | null {
  const clientId = trimEnv("XERO_CLIENT_ID")
  const clientSecret = trimEnv("XERO_CLIENT_SECRET")
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    webhookKey: trimEnv("XERO_WEBHOOK_KEY") ?? null,
  }
}

export function isXeroConfigured(): boolean {
  return getXeroCredentials() !== null
}

function resolveRedirectUri(requestOrigin?: string): string | null {
  const override = trimEnv("XERO_REDIRECT_URI")
  if (override) return override
  if (requestOrigin) {
    return `${requestOrigin.replace(/\/$/, "")}/api/integrations/xero/callback`
  }
  return null
}

/** Full OAuth config — pass requestOrigin on Connect/callback routes. */
export function getXeroConfig(requestOrigin?: string): XeroConfig | null {
  const creds = getXeroCredentials()
  if (!creds) return null
  const redirectUri = resolveRedirectUri(requestOrigin)
  if (!redirectUri) return null
  return { ...creds, redirectUri }
}

/**
 * Granular Accounting API scopes (required for Xero apps created on/after 2 Mar 2026).
 * The legacy broad scope `accounting.transactions` causes invalid_scope on new apps.
 * Override with XERO_SCOPES in .env.local only if your SF admin gives different names.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.settings",
].join(" ")
