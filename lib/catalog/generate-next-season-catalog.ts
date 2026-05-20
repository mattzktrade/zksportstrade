import type { Package, Race } from "@/lib/types/catalog"
import { buildNextSeasonPackage, buildNextSeasonRace, seasonFromRaceId } from "@/lib/catalog/season-rollover"

export function generateNextSeasonRaces(races: Race[], toYear: number): Race[] {
  return races
    .filter((r) => seasonFromRaceId(r.id) === toYear - 1)
    .map((r) => buildNextSeasonRace(r, toYear))
}

export function raceIdForPackageDate(pkgDate: string, races: Race[]): string | null {
  const race = races.find((r) => r.date === pkgDate)
  return race?.id ?? null
}

export function generateNextSeasonPackages(packages: Package[], racesNext: Race[], toYear: number): Package[] {
  const out: Package[] = []
  for (const pkg of packages) {
    if (seasonFromRaceId(pkg.id) !== toYear - 1) continue
    const next = buildNextSeasonPackage(pkg, toYear, "")
    const raceId = raceIdForPackageDate(next.date, racesNext)
    if (!raceId) continue
    out.push({ ...next, raceId })
  }
  return out
}
