export const ADGP_API_SECRET_HEADER = "x-adgp-secret"
export const DEFAULT_ADGP_OWNER_EMAIL = "matt@zk-sports.com"
export const ADGP_NOTIFY_EMAILS = ["bookings@zk-sports.com", "matt@zk-sports.com"] as const
export const ADGP_HOLD_MINUTES = 30
export const CONTACT_ONLY_SLUGS = ["paddock-club"] as const

export const ADGP_DAYS = ["3-day weekend", "Friday", "Saturday", "Sunday"] as const
export type AdgpDay = (typeof ADGP_DAYS)[number]

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export type AdgpConfig = {
  apiSecret: string
  ownerEmail: string
  agentProfileId: string | null
}

export function getAdgpConfig(): AdgpConfig | null {
  const apiSecret = trimEnv("ADGP_API_SECRET")
  if (!apiSecret) return null
  return {
    apiSecret,
    ownerEmail: trimEnv("ADGP_OWNER_EMAIL") ?? DEFAULT_ADGP_OWNER_EMAIL,
    agentProfileId: trimEnv("ADGP_AGENT_PROFILE_ID") ?? null,
  }
}

export function isAdgpApiConfigured(): boolean {
  return Boolean(getAdgpConfig())
}

export function isAdgpDay(value: string): value is AdgpDay {
  return (ADGP_DAYS as readonly string[]).includes(value)
}

export function isContactOnlySlug(slug: string): boolean {
  return (CONTACT_ONLY_SLUGS as readonly string[]).includes(slug.trim())
}
