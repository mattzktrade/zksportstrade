import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { isEventCategory, EVENT_CATEGORY_LABELS } from "@/lib/catalog/event-categories"
import { brochureSafeText } from "@/lib/brochures/text"
import type { BrochureContent } from "@/lib/brochures/types"

const PACKAGE_SELECT =
  "id, race_id, name, circuit, location, country, date_range, description, image, gallery_images, includes, product_code, brochure_url, duration"

export const BROCHURE_PACKAGE_SELECT = PACKAGE_SELECT

export type BrochurePackageRow = {
  id: string
  race_id: string | null
  name: string
  circuit: string | null
  location: string | null
  country: string | null
  date_range: string | null
  description: string | null
  image: string | null
  gallery_images: unknown
  includes: unknown
  product_code: string | null
  brochure_url: string | null
  duration: string | null
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

export function raceDisplayName(name: string, season: number | null): string {
  const trimmed = name.trim()
  if (season && trimmed && !trimmed.includes(String(season))) return `${trimmed} ${season}`
  return trimmed
}

const MONTHS: Record<string, string> = {
  jan: "JANUARY",
  january: "JANUARY",
  feb: "FEBRUARY",
  february: "FEBRUARY",
  mar: "MARCH",
  march: "MARCH",
  apr: "APRIL",
  april: "APRIL",
  may: "MAY",
  jun: "JUNE",
  june: "JUNE",
  jul: "JULY",
  july: "JULY",
  aug: "AUGUST",
  august: "AUGUST",
  sep: "SEPTEMBER",
  sept: "SEPTEMBER",
  september: "SEPTEMBER",
  oct: "OCTOBER",
  october: "OCTOBER",
  nov: "NOVEMBER",
  november: "NOVEMBER",
  dec: "DECEMBER",
  december: "DECEMBER",
}

export function brochureEventFamily(raceName: string, category?: string | null): string {
  if (category && isEventCategory(category) && category !== "other") {
    return EVENT_CATEGORY_LABELS[category].toUpperCase()
  }
  const blob = `${raceName}`.toLowerCase()
  if (/\bformula\s*1\b|\bf1\b|grand prix/.test(blob)) return "FORMULA 1"
  if (/\btennis\b|\bwimbledon\b|\bus open\b/.test(blob)) return "TENNIS"
  if (/\bfootball\b|\bsoccer\b|\bworld cup\b/.test(blob)) return "FOOTBALL"
  if (/\bconcert\b|\bfestival\b/.test(blob)) return "CONCERT"
  return "HOSPITALITY"
}

export function brochurePlaceHeadline(
  raceName: string,
  location: string | null,
  country: string | null,
): string {
  const fromLocation = (location ?? "").replace(/\s*,.*$/, "").trim()
  if (fromLocation && fromLocation.length <= 28) return fromLocation.toUpperCase()
  const stripped = raceName
    .replace(/\bformula\s*1\b/gi, "")
    .replace(/\bf1\b/gi, "")
    .replace(/\bgrand prix\b/gi, "")
    .replace(/\bgp\b/gi, "")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (stripped) return stripped.toUpperCase()
  const fromCountry = (country ?? "").trim()
  return fromCountry ? fromCountry.toUpperCase() : "RACE WEEKEND"
}

export function brochureDateHeadline(dateRange: string | null): string | null {
  if (!dateRange?.trim()) return null
  const raw = dateRange.trim()
  const match = raw.match(
    /^(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/i,
  )
  if (match) {
    const month = MONTHS[match[3].toLowerCase()] ?? match[3].toUpperCase()
    return `${match[1]} TO ${match[2]} ${month} ${match[4]}`
  }
  return brochureSafeText(raw).toUpperCase()
}

export function splitProductHeadline(name: string): { lead: string; accent: string } {
  const words = brochureSafeText(name)
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return { lead: "HOSPITALITY", accent: "EXPERIENCE" }
  if (words.length === 1) return { lead: "", accent: words[0] }
  return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] ?? "" }
}

export function groupBrochureIncludes(
  items: string[],
  maxGroups = 4,
): Array<{ index: string; title: string; bullets: string[] }> {
  const clean = items.map((item) => brochureSafeText(item)).filter(Boolean)
  if (clean.length === 0) return []
  const groupCount = Math.min(maxGroups, clean.length)
  const base = Math.floor(clean.length / groupCount)
  const extra = clean.length % groupCount
  const groups: Array<{ index: string; title: string; bullets: string[] }> = []
  let offset = 0
  for (let i = 0; i < groupCount; i += 1) {
    const len = base + (i < extra ? 1 : 0)
    const chunk = clean.slice(offset, offset + len)
    offset += len
    groups.push({
      index: String(i + 1).padStart(2, "0"),
      title: chunk[0] ?? "",
      bullets: chunk.slice(1),
    })
  }
  return groups
}

export function brochureContentFromPackage(
  row: BrochurePackageRow,
  raceName: string,
  category?: string | null,
): BrochureContent {
  const gallery = asStringList(row.gallery_images)
  const hero = typeof row.image === "string" && row.image.trim() ? row.image.trim() : null
  const resolvedRace = raceName.trim() || row.circuit?.trim() || "Grand Prix"
  return {
    packageId: row.id,
    productName: row.name.trim() || "Hospitality package",
    raceName: resolvedRace,
    circuit: row.circuit?.trim() || null,
    location: row.location?.trim() || null,
    country: row.country?.trim() || null,
    dateRange: row.date_range?.trim() || null,
    durationLabel: packageDurationLabel(row.duration),
    description: typeof row.description === "string" ? row.description.trim() || null : null,
    includes: asStringList(row.includes),
    productCode: row.product_code?.trim() || null,
    heroUrl: hero,
    galleryUrls: gallery,
    eventFamily: brochureEventFamily(resolvedRace, category),
    placeHeadline: brochurePlaceHeadline(resolvedRace, row.location, row.country),
    dateHeadline: brochureDateHeadline(row.date_range),
  }
}
