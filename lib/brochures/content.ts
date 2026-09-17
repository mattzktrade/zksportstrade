import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { isEventCategory, EVENT_CATEGORY_LABELS } from "@/lib/catalog/event-categories"
import { brochurePrintText, uniqueImageUrls } from "@/lib/brochures/text"
import type { BrochureContent } from "@/lib/brochures/types"

const PACKAGE_SELECT =
  "id, race_id, name, circuit, location, country, date_range, description, image, gallery_images, track_map, includes, product_code, brochure_url, duration"

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
  track_map: string | null
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
    const pretty = month.charAt(0) + month.slice(1).toLowerCase()
    return `${match[1]}-${match[2]} ${pretty} ${match[4]}`
  }
  return brochurePrintText(raw)
}

export function brochureVenueLine(
  circuit: string | null,
  location: string | null,
  eventName: string,
): string | null {
  const event = eventName.trim().toLowerCase()
  for (const candidate of [circuit, location]) {
    const value = candidate?.trim()
    if (!value) continue
    if (event && event.includes(value.toLowerCase())) continue
    return brochurePrintText(value)
  }
  return null
}

export function splitProductHeadline(name: string): { lead: string; accent: string } {
  const words = brochurePrintText(name)
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return { lead: "HOSPITALITY", accent: "EXPERIENCE" }
  if (words.length === 1) return { lead: "", accent: words[0] }
  return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] ?? "" }
}

export type BrochureIncludeItem = {
  index: string
  title: string
  detail: string | null
}

export function formatBrochureIncludes(items: string[], maxItems = 8): BrochureIncludeItem[] {
  const clean = items.map((item) => brochurePrintText(item)).filter(Boolean)
  return clean.slice(0, maxItems).map((item, index) => {
    const split = item.match(/^(.{3,44}?):\s+(.+)$/)
    if (split) {
      return {
        index: String(index + 1).padStart(2, "0"),
        title: split[1].trim(),
        detail: split[2].trim(),
      }
    }
    return {
      index: String(index + 1).padStart(2, "0"),
      title: item,
      detail: null,
    }
  })
}

export function isTrackMapImageUrl(url: string): boolean {
  return /track[\s._-]*map|circuit[\s._-]*map|layout[\s._-]*map/i.test(url)
}

export function resolveTrackMapUrl(
  explicit: string | null | undefined,
  heroUrl: string | null,
  galleryUrls: string[],
): string | null {
  const direct = explicit?.trim()
  if (direct) return direct
  for (const url of [heroUrl, ...galleryUrls]) {
    if (url && isTrackMapImageUrl(url)) return url.trim()
  }
  return null
}

export function brochurePhotoUrls(heroUrl: string | null, galleryUrls: string[], trackMapUrl: string | null): string[] {
  const skip = trackMapUrl?.trim() ?? ""
  return uniqueImageUrls(heroUrl, galleryUrls).filter((url) => url !== skip && !isTrackMapImageUrl(url))
}

export function brochureCircuitHeadline(): { lead: string; accent: string } {
  return splitProductHeadline("The details")
}

export function brochureCircuitFacts(content: BrochureContent): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = []
  const event = brochurePrintText(content.raceName)
  if (event) facts.push({ label: "Event", value: event })

  const circuit = brochurePrintText(content.circuit ?? "")
  if (circuit && circuit.toLowerCase() !== event.toLowerCase()) {
    facts.push({ label: "Circuit", value: circuit })
  }

  const placeParts = [content.location, content.country]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
  const place = brochurePrintText(placeParts.join(", "))
  if (place) facts.push({ label: "Location", value: place })

  if (content.dateHeadline) facts.push({ label: "Dates", value: content.dateHeadline })
  return facts
}

export function brochureContentFromPackage(
  row: BrochurePackageRow,
  raceName: string,
  category?: string | null,
): BrochureContent {
  const gallery = asStringList(row.gallery_images)
  const hero = typeof row.image === "string" && row.image.trim() ? row.image.trim() : null
  const resolvedRace = raceName.trim() || row.circuit?.trim() || "Grand Prix"
  const trackMapUrl = resolveTrackMapUrl(
    typeof row.track_map === "string" ? row.track_map : null,
    hero,
    gallery,
  )
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
    trackMapUrl,
    eventFamily: brochureEventFamily(resolvedRace, category),
    placeHeadline: brochurePlaceHeadline(resolvedRace, row.location, row.country),
    dateHeadline: brochureDateHeadline(row.date_range),
  }
}
