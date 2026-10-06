import type { SupabaseClient } from "@supabase/supabase-js"
import { DEFAULT_ASSISTANT_SETTINGS, type AssistantSettings } from "@/lib/assistant/types"
import { parseNotifyEmails } from "@/lib/email/send-booking-form"

export function envKillSwitchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.ASSISTANT_KILL_SWITCH?.trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes"
}

export function llmIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ASSISTANT_LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim())
}

export function mapAssistantSettings(row: {
  auto_send_enabled?: boolean | null
  kill_switch?: boolean | null
  allow_published_trade_prices?: boolean | null
  notify_emails?: string[] | null
  debounce_seconds?: number | null
} | null): AssistantSettings {
  if (!row) return { ...DEFAULT_ASSISTANT_SETTINGS }
  const emails = Array.isArray(row.notify_emails)
    ? row.notify_emails.map((value) => String(value).trim().toLowerCase()).filter((value) => value.includes("@"))
    : []
  return {
    autoSendEnabled: Boolean(row.auto_send_enabled),
    killSwitch: Boolean(row.kill_switch),
    allowPublishedTradePrices: Boolean(row.allow_published_trade_prices),
    notifyEmails: emails.length ? emails : [...DEFAULT_ASSISTANT_SETTINGS.notifyEmails],
    debounceSeconds:
      typeof row.debounce_seconds === "number" && row.debounce_seconds >= 0 ? row.debounce_seconds : 20,
  }
}

export async function loadAssistantSettings(admin: SupabaseClient): Promise<AssistantSettings> {
  const { data } = await admin.from("assistant_settings").select("*").eq("id", "default").maybeSingle()
  const mapped = mapAssistantSettings(data)
  const extra = parseNotifyEmails(process.env.ASSISTANT_NOTIFY_EMAILS ?? "")
  if (extra.length) mapped.notifyEmails = extra
  return mapped
}

export function effectiveKillSwitch(settings: AssistantSettings, env: NodeJS.ProcessEnv = process.env): boolean {
  return settings.killSwitch || envKillSwitchEnabled(env)
}
