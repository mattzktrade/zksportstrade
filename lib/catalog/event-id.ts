/** Slug and display helpers for native `races` rows. */

export function slugifyEventName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

/** Drop a trailing year so "Wimbledon 2026" + season 2026 becomes `wimbledon`, not `wimbledon-2026`. */
export function stripTrailingYear(name: string, season?: number): string {
  const trimmed = name.trim()
  if (!trimmed) return ""
  if (season && Number.isFinite(season)) {
    const withSeason = trimmed.replace(new RegExp(`\\s+${season}$`), "").trim()
    if (withSeason) return withSeason
  }
  const withoutYear = trimmed.replace(/\s+20\d{2}$/, "").trim()
  return withoutYear || trimmed
}

export function nativeEventId(name: string, season: number): string {
  const year = Math.floor(Number(season))
  const slug = slugifyEventName(stripTrailingYear(name, year)) || slugifyEventName(name)
  return `${slug}-${year}`
}

export function enquiryEventShortName(name: string, season?: number): string {
  const short = stripTrailingYear(name, season).trim() || name.trim()
  return short.slice(0, 48)
}

export function seasonFromEventDate(eventDate: string, fallback = new Date().getFullYear()): number {
  const year = Math.floor(Number(eventDate.trim().slice(0, 4)))
  if (!Number.isFinite(year) || year < 2020 || year > 2100) return fallback
  return year
}

export function formatEnquiryEventDateRange(eventDate: string): string {
  const key = eventDate.trim().slice(0, 10)
  const date = new Date(`${key}T00:00:00Z`)
  if (!key || Number.isNaN(date.getTime())) return eventDate.trim()
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
