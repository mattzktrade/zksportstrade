import { nativeEventId } from "@/lib/catalog/event-id"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"

const EVENT_NOISE_PHRASES = ["grand prix", "championships", "championship"]
const EVENT_NOISE_WORDS = new Set(["the", "gp", "official", "presented", "by", "at", "and"])
const PRODUCT_NOISE_WORDS = new Set([
  "the",
  "hospitality",
  "package",
  "packages",
  "ticket",
  "tickets",
  "experience",
  "experiences",
  "and",
  "f1",
])
const DURATION_NOISE_WORDS = new Set([
  "3",
  "2",
  "day",
  "days",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "only",
])

export type CatalogMatchKind = "exact" | "close"

export type CatalogEventCandidate = {
  id: string
  name: string
  shortName?: string | null
  season: number | null
  circuit?: string | null
  location?: string | null
  eventDate?: string | null
  isArchived?: boolean | null
  category?: string | null
}

export type CatalogProductCandidate = {
  id: string
  raceId: string
  name: string
  duration?: string | null
  shellParentPackageId?: string | null
}

export type EventCatalogMatch = CatalogEventCandidate & {
  kind: CatalogMatchKind
  reason: string
}

export type ProductCatalogMatch = CatalogProductCandidate & {
  kind: CatalogMatchKind
  reason: string
}

export type EventMatchInput = {
  name: string
  season: number
  circuit?: string | null
  eventDate?: string | null
}

export type ProductMatchInput = {
  raceId: string
  name: string
  duration?: string | null
}

function foldText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stripNoise(folded: string, phrases: string[], words: Set<string>): string {
  let next = ` ${folded} `
  for (const phrase of phrases) {
    next = next.replace(new RegExp(`\\s${phrase}\\s`, "g"), " ")
  }
  return next
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !words.has(token) && !/^\d{4}$/.test(token))
    .join(" ")
}

export function normalizeEventName(name: string): string {
  return stripNoise(foldText(name), EVENT_NOISE_PHRASES, EVENT_NOISE_WORDS)
}

export function normalizeProductName(name: string): string {
  return stripNoise(foldText(name), [], PRODUCT_NOISE_WORDS)
}

function paddockCoreName(name: string): string {
  return stripNoise(normalizeProductName(name), [], DURATION_NOISE_WORDS)
}

export function normalizeVenue(value: string): string {
  return foldText(value)
}

function namesAlign(left: string, right: string, minLength = 4): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (left.length < minLength || right.length < minLength) return false
  return left.includes(right) || right.includes(left)
}

function tokensOverlap(left: string, right: string): boolean {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2))
  if (leftTokens.size === 0) return false
  return right.split(" ").some((token) => token.length > 2 && leftTokens.has(token))
}

export function eventDateDistanceDays(left: string | null | undefined, right: string | null | undefined): number | null {
  const a = left?.trim().slice(0, 10) ?? ""
  const b = right?.trim().slice(0, 10) ?? ""
  if (!a || !b) return null
  const start = Date.parse(`${a}T00:00:00Z`)
  const end = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.abs(start - end) / 86_400_000
}

function seasonOf(candidate: CatalogEventCandidate): number {
  return Math.floor(Number(candidate.season) || 0)
}

export function findEventCatalogMatches(
  input: EventMatchInput,
  candidates: CatalogEventCandidate[],
): EventCatalogMatch[] {
  const name = input.name.trim()
  const season = Math.floor(Number(input.season) || 0)
  if (!name || !season) return []
  const generatedId = nativeEventId(name, season)
  const normalized = normalizeEventName(name)
  const venue = normalizeVenue(input.circuit ?? "")
  const matches = new Map<string, EventCatalogMatch>()

  function add(candidate: CatalogEventCandidate, kind: CatalogMatchKind, reason: string) {
    const existing = matches.get(candidate.id)
    if (existing && (existing.kind === "exact" || kind === "close")) return
    matches.set(candidate.id, { ...candidate, kind, reason })
  }

  for (const candidate of candidates) {
    if (candidate.id === generatedId) {
      add(candidate, "exact", "Same event name and season.")
      continue
    }
    if (seasonOf(candidate) === season) {
      const candidateName = candidate.name.trim()
      if (candidateName.toLowerCase() === name.toLowerCase()) {
        add(candidate, "exact", "Same event name and season.")
        continue
      }
      const candidateNormalized = normalizeEventName(candidateName)
      const shortNormalized = normalizeEventName(String(candidate.shortName ?? ""))
      if (
        namesAlign(normalized, candidateNormalized) ||
        (shortNormalized && namesAlign(normalized, shortNormalized))
      ) {
        add(candidate, "close", "A similar event already exists for this season.")
        continue
      }
    }
    if (!venue) continue
    const candidateVenue = normalizeVenue(String(candidate.circuit ?? candidate.location ?? ""))
    if (!candidateVenue || candidateVenue !== venue) continue
    const days = eventDateDistanceDays(input.eventDate, candidate.eventDate)
    if (days == null || days > 7) continue
    const candidateNormalized = normalizeEventName(candidate.name)
    if (normalized && candidateNormalized && !tokensOverlap(normalized, candidateNormalized) && !namesAlign(normalized, candidateNormalized)) {
      continue
    }
    add(candidate, "close", "An event already exists at this venue around the same dates.")
  }

  return [...matches.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function sameDuration(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = (left ?? "").trim()
  const b = (right ?? "").trim()
  if (!a || !b) return false
  return a === b
}

export function findProductCatalogMatches(
  input: ProductMatchInput,
  candidates: CatalogProductCandidate[],
): ProductCatalogMatch[] {
  const name = input.name.trim()
  const raceId = input.raceId.trim()
  if (!name || !raceId) return []
  const normalized = normalizeProductName(name)
  const paddock = isPaddockClubPackageName(name)
  const duration = (input.duration ?? "").trim() || null
  const matches = new Map<string, ProductCatalogMatch>()

  function add(candidate: CatalogProductCandidate, kind: CatalogMatchKind, reason: string) {
    const existing = matches.get(candidate.id)
    if (existing && (existing.kind === "exact" || kind === "close")) return
    matches.set(candidate.id, { ...candidate, kind, reason })
  }

  for (const candidate of candidates) {
    if (candidate.raceId !== raceId) continue
    if (candidate.shellParentPackageId) continue
    const candidateName = candidate.name.trim()
    if (!candidateName) continue
    if (candidateName.toLowerCase() === name.toLowerCase()) {
      add(candidate, "exact", "A product with this name already exists for this event.")
      continue
    }
    const candidateNormalized = normalizeProductName(candidateName)
    if (normalized && candidateNormalized && normalized === candidateNormalized) {
      add(candidate, "close", "A similar product already exists for this event.")
      continue
    }
    if (
      paddock &&
      isPaddockClubPackageName(candidateName) &&
      sameDuration(duration, candidate.duration) &&
      paddockCoreName(name) === paddockCoreName(candidateName)
    ) {
      add(candidate, "exact", "Paddock Club for this duration already exists on this event.")
    }
  }

  return [...matches.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function catalogMatchMessage(kind: "event" | "product", matches: Array<{ name: string; kind: CatalogMatchKind }>): string {
  const first = matches[0]
  if (!first) return kind === "event" ? "An event already exists." : "A product already exists."
  if (kind === "event") {
    return first.kind === "exact"
      ? `An event named “${first.name}” already exists. Use that one.`
      : `A similar event already exists (“${first.name}”). Use that one instead of creating a duplicate.`
  }
  return first.kind === "exact"
    ? `A product named “${first.name}” already exists on this event. Use that one.`
    : `A similar product already exists (“${first.name}”). Use that one instead of creating a duplicate.`
}
