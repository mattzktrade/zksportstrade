import type { Package, Race } from "@/lib/types/catalog"
import { bookableEventDateFrom } from "@/lib/catalog/bookable-events"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"

export const PORTAL_CATALOG_SEASONS = [2026, 2027] as const
export type PortalCatalogSeasonYear = (typeof PORTAL_CATALOG_SEASONS)[number]
export const DEFAULT_PORTAL_SEASON: PortalCatalogSeasonYear = 2026

export type CatalogSeasonSlice = {
  year: PortalCatalogSeasonYear
  label: string
  races: Race[]
  packages: Package[]
  /** Shown under season tabs when dates are not confirmed yet. */
  datesNote?: string
}

export type PortalCatalog = {
  seasons: CatalogSeasonSlice[]
  defaultSeasonYear: PortalCatalogSeasonYear
}

export function getSeasonSlice(catalog: PortalCatalog, year: number): CatalogSeasonSlice | undefined {
  return catalog.seasons.find((s) => s.year === year)
}

export function packageIdsForRaces(races: Race[]): Set<string> {
  return new Set(races.map((r) => r.id))
}

export function filterPackagesForRaces(packages: Package[], races: Race[]): Package[] {
  const raceIds = packageIdsForRaces(races)
  return packages.filter((p) => p.raceId && raceIds.has(p.raceId))
}

/** 2026: upcoming races only. 2027: full calendar with dates TBC. */
export function buildPortalSeasonSlices(
  allRaces: Race[],
  allPackages: Package[],
  bookableFrom = bookableEventDateFrom(),
): CatalogSeasonSlice[] {
  const slices: CatalogSeasonSlice[] = []

  for (const year of PORTAL_CATALOG_SEASONS) {
    const seasonRaces = allRaces
      .filter((r) => (r.season ?? seasonFromRaceId(r.id)) === year)
      .filter((r) => (year === 2027 ? true : r.date >= bookableFrom))
      .sort((a, b) => a.date.localeCompare(b.date))

    const raceIds = new Set(seasonRaces.map((r) => r.id))
    const seasonPackages = allPackages.filter((p) => p.raceId && raceIds.has(p.raceId))

    slices.push({
      year,
      label: `${year} Season`,
      races: seasonRaces,
      packages: seasonPackages,
      datesNote:
        year === 2027
          ? "Race weekend dates for 2027 are to be confirmed. Please enquire about any package for next years races and we will be able to help."
          : undefined,
    })
  }

  return slices.filter((s) => s.races.length > 0)
}
