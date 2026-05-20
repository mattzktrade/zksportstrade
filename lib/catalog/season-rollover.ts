import type { Package, Race } from "@/lib/types/catalog"
import { bookableEventDateFrom } from "@/lib/catalog/bookable-events"

/** e.g. `monaco-2026` → `monaco` */
export function circuitKeyFromRaceId(raceId: string): string {
  const m = raceId.match(/^(.+)-(\d{4})$/)
  return m ? m[1] : raceId
}

export function seasonFromRaceId(raceId: string): number | null {
  const m = raceId.match(/-(\d{4})$/)
  return m ? Number(m[1]) : null
}

/** e.g. `monaco-velocity-terrace-sun-sat-2026` → `monaco-velocity-terrace-sun-sat` */
export function packageStemFromId(packageId: string): string {
  return packageId.replace(/-\d{4}$/, "")
}

export type RaceRowLike = {
  id: string
  event_date: string
  season?: number
}

/**
 * One sellable race per circuit: the earliest event still on or after today (London).
 * When the 2026 date passes, the 2027 row for that circuit becomes the active one.
 */
export function pickActiveSellingRaces<T extends RaceRowLike>(races: T[], bookableFrom = bookableEventDateFrom()): T[] {
  const byCircuit = new Map<string, T[]>()
  for (const race of races) {
    const key = circuitKeyFromRaceId(race.id)
    const list = byCircuit.get(key) ?? []
    list.push(race)
    byCircuit.set(key, list)
  }

  const active: T[] = []
  for (const list of byCircuit.values()) {
    list.sort((a, b) => a.event_date.localeCompare(b.event_date))
    const upcoming = list.filter((r) => r.event_date >= bookableFrom)
    if (upcoming.length > 0) {
      active.push(upcoming[0])
    }
  }

  active.sort((a, b) => a.event_date.localeCompare(b.event_date))
  return active
}

export function activeRaceIdSet(races: RaceRowLike[], bookableFrom = bookableEventDateFrom()): Set<string> {
  return new Set(pickActiveSellingRaces(races, bookableFrom).map((r) => r.id))
}

/** Label for dashboard / packages header from the races currently on sale. */
export function sellingSeasonLabel(races: RaceRowLike[]): string {
  const seasons = [...new Set(races.map((r) => seasonFromRaceId(r.id)).filter((y): y is number => y != null))].sort()
  if (seasons.length === 0) return "Season"
  if (seasons.length === 1) return `${seasons[0]} Season`
  return `${seasons[0]} & ${seasons[seasons.length - 1]} Season`
}

export function resolveActiveRaceIdForCircuit(allRaces: RaceRowLike[], raceId: string): string | null {
  const key = circuitKeyFromRaceId(raceId)
  const bookableFrom = bookableEventDateFrom()
  const active = pickActiveSellingRaces(
    allRaces.filter((r) => circuitKeyFromRaceId(r.id) === key),
    bookableFrom,
  )
  return active[0]?.id ?? null
}

/** Featured templates use any season suffix; match the stem on currently active packages. */
export function pickFeaturedPackagesByStem(templateIds: readonly string[], packages: Package[]): Package[] {
  const byStem = new Map(packages.map((p) => [packageStemFromId(p.id), p]))
  const seen = new Set<string>()
  const out: Package[] = []
  for (const templateId of templateIds) {
    const stem = packageStemFromId(templateId)
    const pkg = byStem.get(stem)
    if (pkg && !seen.has(pkg.id)) {
      seen.add(pkg.id)
      out.push(pkg)
    }
  }
  return out
}

export function featuredTaglineForPackage(packageId: string, taglinesByTemplateId: Record<string, string>): string | null {
  const stem = packageStemFromId(packageId)
  for (const [templateId, tagline] of Object.entries(taglinesByTemplateId)) {
    if (packageStemFromId(templateId) === stem) return tagline
  }
  return null
}

export function shiftIsoDate(isoDate: string, yearDelta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  return `${y + yearDelta}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function nextSeasonId(id: string, toYear: number): string {
  const fromYear = seasonFromRaceId(id)
  if (fromYear == null) return `${id}-${toYear}`
  return `${circuitKeyFromRaceId(id)}-${toYear}`
}

export const DATES_TBC_LABEL = "Dates TBC"

export function buildNextSeasonRace(race: Race, toYear: number): Race {
  const fromYear = seasonFromRaceId(race.id) ?? toYear - 1
  const delta = toYear - fromYear
  return {
    ...race,
    id: nextSeasonId(race.id, toYear),
    name: race.name.includes(String(fromYear)) ? race.name.replace(String(fromYear), String(toYear)) : race.name,
    date: shiftIsoDate(race.date, delta),
    dateRange: DATES_TBC_LABEL,
    season: toYear,
  }
}

export function buildNextSeasonPackage(pkg: Package, toYear: number, raceId: string): Package {
  const fromYear = seasonFromRaceId(pkg.id) ?? toYear - 1
  const delta = toYear - fromYear
  return {
    ...pkg,
    id: nextSeasonId(pkg.id, toYear),
    date: shiftIsoDate(pkg.date, delta),
    dateRange: DATES_TBC_LABEL,
    raceId,
  }
}

export function racesForSeasonYear<T extends RaceRowLike>(races: T[], year: number): T[] {
  return races.filter((r) => seasonFromRaceId(r.id) === year)
}
