import type { Race } from "@/lib/types/catalog"

export const CATALOG_REGIONS = [
  { id: "middle-east", name: "Middle East", countries: ["Bahrain", "Saudi Arabia", "Qatar", "Abu Dhabi"] },
  { id: "asia-pacific", name: "Asia Pacific", countries: ["Australia", "Japan", "China", "Singapore"] },
  {
    id: "europe",
    name: "Europe",
    countries: ["Monaco", "Spain", "Portugal", "Austria", "UK", "Belgium", "Hungary", "Italy", "Türkiye", "Azerbaijan"],
  },
  { id: "americas", name: "Americas", countries: ["USA", "Canada", "Mexico", "Brazil"] },
] as const

export type CatalogRegionId = (typeof CATALOG_REGIONS)[number]["id"]

/** Alternate country names used in catalog seed data. */
const REGION_MATCH_ALIASES: Record<string, string[]> = {
  UK: ["United Kingdom", "Great Britain"],
  USA: ["United States"],
  "Abu Dhabi": ["UAE", "United Arab Emirates"],
  Türkiye: ["Turkey"],
}

/** Extra F1 calendar countries that belong to a region but are not in the marketing list. */
const REGION_EXTRA_COUNTRIES: Record<CatalogRegionId, string[]> = {
  "middle-east": ["UAE", "United Arab Emirates"],
  "asia-pacific": ["Malaysia"],
  europe: ["Netherlands"],
  americas: ["United States"],
}

function matchNeedlesForRegion(regionId: CatalogRegionId): string[] {
  const region = CATALOG_REGIONS.find((item) => item.id === regionId)
  if (!region) return []
  const extras = REGION_EXTRA_COUNTRIES[regionId] ?? []
  return [...region.countries, ...extras].flatMap((name) => [name, ...(REGION_MATCH_ALIASES[name] ?? [])])
}

export function locationMatchesRegion(country: string, location: string, regionId: string): boolean {
  if (regionId === "all") return true
  const region = CATALOG_REGIONS.find((item) => item.id === regionId)
  if (!region) return true
  const hay = `${country} ${location}`.toLowerCase()
  return matchNeedlesForRegion(region.id).some((needle) => hay.includes(needle.toLowerCase()))
}

export function regionIdForLocation(country: string, location: string): CatalogRegionId | null {
  for (const region of CATALOG_REGIONS) {
    if (locationMatchesRegion(country, location, region.id)) return region.id
  }
  return null
}

export function regionNameForId(regionId: string | null | undefined): string | null {
  if (!regionId) return null
  return CATALOG_REGIONS.find((region) => region.id === regionId)?.name ?? null
}

export function raceMatchesRegion(race: Pick<Race, "location" | "country">, regionId: string): boolean {
  return locationMatchesRegion(race.country, race.location, regionId)
}

export function groupRacesByRegion<T extends Race>(races: T[]): { region: (typeof CATALOG_REGIONS)[number]; races: T[] }[] {
  const groups: { region: (typeof CATALOG_REGIONS)[number]; races: T[] }[] = []
  for (const region of CATALOG_REGIONS) {
    const inRegion = races.filter((r) => raceMatchesRegion(r, region.id))
    if (inRegion.length > 0) groups.push({ region, races: inRegion })
  }
  return groups
}
