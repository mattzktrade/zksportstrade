import { getXeroConfig, getXeroCredentials, XERO_SCOPES } from "@/lib/integrations/xero/config"
import {
  getIntegrationSetting,
  getStoredXeroRefreshToken,
  getStoredXeroTenantId,
  saveXeroOAuthTokens,
  setIntegrationSetting,
} from "@/lib/integrations/xero/settings-store"

type TokenCache = { accessToken: string; expiresAt: number }
let cache: TokenCache | null = null

/** Xero rotates refresh tokens — only one refresh at a time or others get "token consumed". */
let refreshMutex: Promise<string> = Promise.resolve("")

async function persistRotatedRefreshToken(refreshToken: string): Promise<void> {
  const tenantId = await getStoredXeroTenantId()
  const tenantName = (await getIntegrationSetting("xero_tenant_name")) ?? tenantId ?? ""
  if (tenantId) {
    await saveXeroOAuthTokens(refreshToken, tenantId, tenantName)
  } else {
    await setIntegrationSetting("xero_refresh_token", refreshToken)
  }
}

export function buildXeroAuthorizeUrl(state: string, requestOrigin: string): string {
  const config = getXeroConfig(requestOrigin)
  if (!config) throw new Error("Xero OAuth is not configured.")

  const q = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: XERO_SCOPES,
    state,
  })
  return `https://login.xero.com/identity/connect/authorize?${q.toString()}`
}

export async function exchangeXeroAuthorizationCode(
  code: string,
  requestOrigin: string,
): Promise<{ refreshToken: string; tenantId: string; tenantName: string }> {
  const config = getXeroConfig(requestOrigin)
  if (!config) throw new Error("Xero OAuth is not configured.")

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  const tokenRes = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  const tokenJson = (await tokenRes.json()) as Record<string, unknown>
  if (!tokenRes.ok) {
    throw new Error(String(tokenJson.error_description ?? tokenJson.error ?? "Xero token exchange failed"))
  }

  const refreshToken = String(tokenJson.refresh_token ?? "")
  const accessToken = String(tokenJson.access_token ?? "")
  if (!refreshToken || !accessToken) throw new Error("Xero did not return tokens.")

  const connectionsRes = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  })
  const connections = (await connectionsRes.json()) as Array<{
    tenantId?: string
    tenantName?: string
  }>
  if (!connectionsRes.ok || !connections[0]?.tenantId) {
    throw new Error("No Xero organisation connected. Authorise the app for your ZK Sports org.")
  }

  const tenantId = connections[0].tenantId!
  const tenantName = connections[0].tenantName ?? tenantId
  await saveXeroOAuthTokens(refreshToken, tenantId, tenantName)
  cache = null
  return { refreshToken, tenantId, tenantName }
}

async function refreshXeroAccessToken(): Promise<{ accessToken: string; tenantId: string }> {
  const refreshToken = await getStoredXeroRefreshToken()
  if (!refreshToken) {
    throw new Error("Xero is not connected. Open Admin → Integrations → Xero → Connect.")
  }
  const tenantId = await getStoredXeroTenantId()
  if (!tenantId) throw new Error("Xero tenant id missing. Reconnect Xero.")

  const creds = getXeroCredentials()
  if (!creds) throw new Error("Xero Client ID/Secret not configured.")

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })

  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const msg = String(json.error_description ?? json.error ?? "Xero token refresh failed")
    if (/refresh token has been consumed|invalid_grant/i.test(msg)) {
      throw new Error(
        `${msg} Click Reconnect Xero on Admin → Integrations → Xero, then retry the sync queue.`,
      )
    }
    throw new Error(msg)
  }

  const accessToken = String(json.access_token ?? "")
  if (!accessToken) throw new Error("Xero refresh did not return access_token.")

  const rotated = String(json.refresh_token ?? "").trim()
  if (rotated && rotated !== refreshToken) {
    await persistRotatedRefreshToken(rotated)
  }

  const expiresIn = Number(json.expires_in ?? 1800)
  cache = { accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  return { accessToken, tenantId }
}

export async function getXeroAccessToken(): Promise<{ accessToken: string; tenantId: string }> {
  if (cache && cache.expiresAt > Date.now() + 60_000) {
    const tenantId = await getStoredXeroTenantId()
    if (!tenantId) throw new Error("Xero tenant is not configured.")
    return { accessToken: cache.accessToken, tenantId }
  }

  const prev = refreshMutex
  let release!: () => void
  refreshMutex = new Promise((resolve) => {
    release = () => resolve("")
  })

  await prev
  try {
    if (cache && cache.expiresAt > Date.now() + 60_000) {
      const tenantId = await getStoredXeroTenantId()
      if (!tenantId) throw new Error("Xero tenant is not configured.")
      return { accessToken: cache.accessToken, tenantId }
    }
    return await refreshXeroAccessToken()
  } finally {
    release()
  }
}
