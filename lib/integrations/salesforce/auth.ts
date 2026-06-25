import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getStoredInstanceUrl, getStoredRefreshToken } from "@/lib/integrations/salesforce/settings-store"

type TokenCache = { accessToken: string; instanceUrl: string; expiresAt: number }
let cache: TokenCache | null = null

export async function getSalesforceAccessToken(): Promise<{ accessToken: string; instanceUrl: string }> {
  if (cache && cache.expiresAt > Date.now() + 60_000) {
    return { accessToken: cache.accessToken, instanceUrl: cache.instanceUrl }
  }

  const refreshToken = await getStoredRefreshToken()
  if (!refreshToken) {
    throw new Error(
      "Salesforce is not connected. Open Admin → Integrations → Salesforce and click Connect.",
    )
  }

  const instanceUrl = await getStoredInstanceUrl()
  const config = getSalesforceConfig(instanceUrl ?? undefined)
  if (!config) {
    throw new Error("Salesforce Client ID, Client Secret, and Instance URL are not configured.")
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  })

  const tokenUrl = `${config.loginUrl.replace(/\/$/, "")}/services/oauth2/token`
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const msg = typeof json.error_description === "string" ? json.error_description : JSON.stringify(json)
    if (/client identifier invalid/i.test(msg)) {
      throw new Error(
        "Salesforce token refresh failed: client identifier invalid. Reconnect Salesforce from Admin -> Integrations -> Salesforce because the saved refresh token does not match the current Salesforce Client ID/Secret.",
      )
    }
    throw new Error(`Salesforce token refresh failed: ${msg}`)
  }

  const accessToken = String(json.access_token ?? "")
  const resolvedInstance = String(json.instance_url ?? config.instanceUrl).replace(/\/$/, "")
  if (!accessToken) throw new Error("Salesforce token response missing access_token.")

  const expiresIn = Number(json.expires_in ?? 3600)
  cache = {
    accessToken,
    instanceUrl: resolvedInstance,
    expiresAt: Date.now() + expiresIn * 1000,
  }

  return { accessToken, instanceUrl: resolvedInstance }
}

export function clearSalesforceTokenCache(): void {
  cache = null
}

export async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ refreshToken: string; instanceUrl: string }> {
  const config = getSalesforceConfig()
  if (!config) throw new Error("Salesforce OAuth is not configured.")

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  })

  const tokenUrl = `${config.loginUrl.replace(/\/$/, "")}/services/oauth2/token`
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const msg = typeof json.error_description === "string" ? json.error_description : JSON.stringify(json)
    throw new Error(`Salesforce authorization failed: ${msg}`)
  }

  const refreshToken = String(json.refresh_token ?? "")
  const instanceUrl = String(json.instance_url ?? config.instanceUrl).replace(/\/$/, "")
  if (!refreshToken) {
    throw new Error("Salesforce did not return a refresh token. Ensure offline_access scope is enabled.")
  }

  clearSalesforceTokenCache()
  return { refreshToken, instanceUrl }
}

export function buildAuthorizeUrl(params: {
  redirectUri: string
  state: string
  codeChallenge: string
}): string {
  const config = getSalesforceConfig()
  if (!config) throw new Error("Salesforce OAuth is not configured.")

  const q = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: params.redirectUri,
    scope: "api refresh_token offline_access",
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  })

  return `${config.loginUrl.replace(/\/$/, "")}/services/oauth2/authorize?${q.toString()}`
}
