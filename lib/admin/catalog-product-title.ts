import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { nameIncludesDurationLabel, packageDurationTitlePrefix } from "@/lib/catalog/package-duration"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"
import { adminRaceSeasonYear } from "@/lib/admin/race-label"

/** e.g. "Australian Grand Prix 2026 - 3 Day Legend Paddock Club" */
export function adminCatalogProductTitle(params: {
  raceName: string
  seasonYear: number | null
  packageName: string
  duration?: string | null
}): string {
  const { raceName, seasonYear, packageName, duration } = params
  const yearPart = seasonYear != null ? ` ${seasonYear}` : ""
  const durationPrefix =
    nameIncludesDurationLabel(packageName) ? null : packageDurationTitlePrefix(duration)
  const packagePart = durationPrefix ? `${durationPrefix} ${packageName}` : packageName
  return `${raceName}${yearPart} - ${packagePart}`
}

export function adminCatalogProductTitleFromPackage(
  pkg: Pick<AdminPackageRow, "name" | "duration" | "race_id" | "race_name">,
  race?: AdminRaceOption | null,
): string {
  const raceName = race?.name ?? pkg.race_name
  const seasonYear = race ? adminRaceSeasonYear(race) : seasonFromRaceId(pkg.race_id)
  return adminCatalogProductTitle({
    raceName,
    seasonYear,
    packageName: pkg.name,
    duration: pkg.duration,
  })
}
