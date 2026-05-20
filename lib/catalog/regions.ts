import type { Race } from "@/lib/types/catalog"

export const CATALOG_REGIONS = [
  { id: "middle-east", name: "Middle East", countries: ["Bahrain", "Saudi Arabia", "Qatar", "Abu Dhabi"] },
  { id: "asia-pacific", name: "Asia Pacific", countries: ["Australia", "Japan", "China", "Singapore"] },
  {
    id: "europe",
    name: "Europe",
    countries: ["Monaco", "Spain", "Austria", "UK", "Belgium", "Hungary", "Netherlands", "Italy", "Azerbaijan"],
  },
  { id: "americas", name: "Americas", countries: ["USA", "Canada", "Mexico", "Brazil"] },
] as const

export function raceMatchesRegion(race: Race, regionId: string): boolean {
  if (regionId === "all") return true
  const region = CATALOG_REGIONS.find((r) => r.id === regionId)
  if (!region) return true
  return region.countries.some(
    (country) => race.location.includes(country) || race.country === country,
  )
}

export function groupRacesByRegion<T extends Race>(races: T[]): { region: (typeof CATALOG_REGIONS)[number]; races: T[] }[] {
  const groups: { region: (typeof CATALOG_REGIONS)[number]; races: T[] }[] = []
  for (const region of CATALOG_REGIONS) {
    const inRegion = races.filter((r) => raceMatchesRegion(r, region.id))
    if (inRegion.length > 0) groups.push({ region, races: inRegion })
  }
  return groups
}
