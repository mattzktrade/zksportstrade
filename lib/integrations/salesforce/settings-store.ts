import { createAdminClient } from "@/lib/supabase/admin"

const KEY_REFRESH = "salesforce_refresh_token"
const KEY_INSTANCE = "salesforce_instance_url"

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

export async function getStoredRefreshToken(): Promise<string | null> {
  return (await getIntegrationSetting(KEY_REFRESH)) ?? process.env.SALESFORCE_REFRESH_TOKEN?.trim() ?? null
}

export async function getStoredInstanceUrl(): Promise<string | null> {
  return (await getIntegrationSetting(KEY_INSTANCE)) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? null
}

export async function saveOAuthTokens(refreshToken: string, instanceUrl: string): Promise<void> {
  await setIntegrationSetting(KEY_REFRESH, refreshToken)
  await setIntegrationSetting(KEY_INSTANCE, instanceUrl.replace(/\/$/, ""))
}

export async function getSalesforceConnectionStatus(): Promise<{
  configured: boolean
  connected: boolean
  instanceUrl: string | null
}> {
  const configured = Boolean(
    process.env.SALESFORCE_CLIENT_ID?.trim() && process.env.SALESFORCE_CLIENT_SECRET?.trim(),
  )
  const refresh = await getStoredRefreshToken()
  const instanceUrl = await getStoredInstanceUrl()
  return {
    configured,
    connected: Boolean(refresh && instanceUrl),
    instanceUrl,
  }
}
