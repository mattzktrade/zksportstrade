import { createAdminClient } from "@/lib/supabase/admin"
import { isXeroConfigured } from "@/lib/integrations/xero/config"
import {
  cooldownMsFromRetryAfter,
  XERO_RATE_LIMIT_COOLDOWN_KEY,
} from "@/lib/integrations/xero/rate-limit"

const KEY_REFRESH = "xero_refresh_token"
const KEY_TENANT = "xero_tenant_id"
const KEY_TENANT_NAME = "xero_tenant_name"

export async function getIntegrationSetting(key: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data, error } = await admin.from("integration_settings").select("value").eq("key", key).maybeSingle()
  if (error || !data) return null
  return typeof data.value === "string" ? data.value : null
}

export async function setIntegrationSetting(key: string, value: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { error } = await admin.from("integration_settings").upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function getStoredXeroRefreshToken(): Promise<string | null> {
  return (await getIntegrationSetting(KEY_REFRESH)) ?? process.env.XERO_REFRESH_TOKEN?.trim() ?? null
}

export async function getStoredXeroTenantId(): Promise<string | null> {
  return (await getIntegrationSetting(KEY_TENANT)) ?? process.env.XERO_TENANT_ID?.trim() ?? null
}

export async function saveXeroOAuthTokens(refreshToken: string, tenantId: string, tenantName: string): Promise<void> {
  await setIntegrationSetting(KEY_REFRESH, refreshToken)
  await setIntegrationSetting(KEY_TENANT, tenantId)
  await setIntegrationSetting(KEY_TENANT_NAME, tenantName)
}

export async function getXeroConnectionStatus(): Promise<{
  configured: boolean
  connected: boolean
  tenantName: string | null
}> {
  const configured = isXeroConfigured()
  const refresh = await getStoredXeroRefreshToken()
  const tenant = await getStoredXeroTenantId()
  const tenantName = await getIntegrationSetting(KEY_TENANT_NAME)
  return {
    configured,
    connected: Boolean(refresh && tenant),
    tenantName,
  }
}

export async function getXeroRateLimitCooldownUntilMs(): Promise<number | null> {
  const until = await getIntegrationSetting(XERO_RATE_LIMIT_COOLDOWN_KEY)
  if (!until) return null
  const t = new Date(until).getTime()
  if (!Number.isFinite(t) || t <= Date.now()) return null
  return t
}

export async function isXeroRateLimitCooldownActive(): Promise<boolean> {
  return (await getXeroRateLimitCooldownUntilMs()) != null
}

export async function markXeroRateLimitCooldown(retryAfterMs?: number | null): Promise<void> {
  try {
    const ms = cooldownMsFromRetryAfter(retryAfterMs)
    await setIntegrationSetting(XERO_RATE_LIMIT_COOLDOWN_KEY, new Date(Date.now() + ms).toISOString())
  } catch (e) {
    console.warn("[xero] Failed to persist rate-limit cooldown:", e instanceof Error ? e.message : e)
  }
}
