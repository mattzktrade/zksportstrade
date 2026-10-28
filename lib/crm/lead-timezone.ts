import { normalizeMarketingPhone } from "@/lib/integrations/marketing-leads/parse"

export const DEFAULT_LEAD_TIMEZONE = "Asia/Dubai"
export const LEAD_CONTACT_WINDOW = { startHour: 9, endHour: 20 } as const

/** Longest prefixes first so 971 wins over 9x and 353 over 35x. */
const PHONE_PREFIX_TIMEZONES: ReadonlyArray<readonly [string, string]> = [
  ["971", "Asia/Dubai"],
  ["966", "Asia/Riyadh"],
  ["974", "Asia/Qatar"],
  ["973", "Asia/Bahrain"],
  ["965", "Asia/Kuwait"],
  ["968", "Asia/Muscat"],
  ["353", "Europe/Dublin"],
  ["44", "Europe/London"],
  ["91", "Asia/Kolkata"],
  ["92", "Asia/Karachi"],
  ["49", "Europe/Berlin"],
  ["33", "Europe/Paris"],
  ["39", "Europe/Rome"],
  ["34", "Europe/Madrid"],
  ["31", "Europe/Amsterdam"],
  ["41", "Europe/Zurich"],
  ["20", "Africa/Cairo"],
  ["27", "Africa/Johannesburg"],
  ["61", "Australia/Sydney"],
  ["65", "Asia/Singapore"],
  ["86", "Asia/Shanghai"],
  ["7", "Europe/Moscow"],
  ["1", "America/New_York"],
]

/** Best guess from the international dialling code. Local or unknown numbers use Dubai. */
export function timezoneForPhone(phone: string | null | undefined): string {
  const digits = normalizeMarketingPhone(phone).replace(/^00/, "")
  if (digits.length < 8 || digits.startsWith("0")) return DEFAULT_LEAD_TIMEZONE
  for (const [prefix, zone] of PHONE_PREFIX_TIMEZONES) {
    if (digits.startsWith(prefix)) return zone
  }
  return DEFAULT_LEAD_TIMEZONE
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number }

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") }
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}

/** Wall-clock time in a zone (day may overflow; Date.UTC normalises it). */
export function zonedTime(
  input: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute ?? 0)
  const first = guess - offsetMs(new Date(guess), timeZone)
  return new Date(guess - offsetMs(new Date(first), timeZone))
}

/** Same calendar day as `date` in the zone, plus `addDays`, at the given hour. */
export function localDayAt(date: Date, timeZone: string, addDays: number, hour: number): Date {
  const p = zonedParts(date, timeZone)
  return zonedTime({ year: p.year, month: p.month, day: p.day + addDays, hour }, timeZone)
}

export function isInsideContactWindow(date: Date, timeZone: string): boolean {
  const { hour } = zonedParts(date, timeZone)
  return hour >= LEAD_CONTACT_WINDOW.startHour && hour < LEAD_CONTACT_WINDOW.endHour
}

/** `date` if it is inside 9:00–20:00 local, otherwise the next 9:00 local. */
export function nextContactWindowTime(date: Date, timeZone: string): Date {
  if (isInsideContactWindow(date, timeZone)) return date
  const { hour } = zonedParts(date, timeZone)
  return localDayAt(date, timeZone, hour >= LEAD_CONTACT_WINDOW.endHour ? 1 : 0, LEAD_CONTACT_WINDOW.startHour)
}
