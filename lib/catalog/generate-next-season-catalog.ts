import type { Package, Race } from "@/lib/types/catalog"
import { apply2027CalendarAdjustments } from "@/lib/catalog/season-2027-calendar"
import { buildNextSeasonPackage, buildNextSeasonRace, seasonFromRaceId } from "@/lib/catalog/season-rollover"

export function generateNextSeasonRaces(races: Race[], toYear: number): Race[] {
  const generated = races
    .filter((r) => seasonFromRaceId(r.id) === toYear - 1)
    .map((r) => buildNextSeasonRace(r, toYear))
  if (toYear === 2027) return apply2027CalendarAdjustments(generated)
  return generated
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
