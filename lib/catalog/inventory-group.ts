/**
 * Durations that participate in linked inventory for a product group.
 * Saturday and Sunday are independent; 2-day tracks min(Sat, Sun).
 */
export const SPLITTABLE_PACKAGE_DURATIONS = new Set([
  "2_day",
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

/** Suffixes stripped from package ids when deriving a shared inventory group key. */
const PACKAGE_ID_DURATION_SUFFIXES = [
  "-sun-sat",
  "-sat-sun",
  "-sunday",
  "-saturday",
  "-friday",
  "-thursday",
  "-2day",
  "-2-day",
] as const

/** Remove trailing season year, e.g. `-2026`. */
export function packageIdWithoutSeasonYear(packageId: string): string {
  return packageId.replace(/-\d{4}$/, "")
}

/** Product stem used to link split day options, e.g. `monaco-velocity-terrace`. */
export function packageInventoryStem(packageId: string): string {
  let stem = packageIdWithoutSeasonYear(packageId)
  for (const suffix of PACKAGE_ID_DURATION_SUFFIXES) {
    if (stem.endsWith(suffix)) {
      return stem.slice(0, -suffix.length)
    }
  }
  return stem
}

/** Group id for split packages at the same race (links cascade rules in the database). */
export function deriveInventoryGroupId(
  packageId: string,
  duration: string | null | undefined,
  raceId: string,
): string | null {
  const d = duration?.trim()
  if (!d || !SPLITTABLE_PACKAGE_DURATIONS.has(d)) return null
  const stem = packageInventoryStem(packageId)
  return `${raceId}/${stem}`
}

export function isSplittablePackageDuration(duration: string | null | undefined): boolean {
  const d = duration?.trim()
  return !!d && SPLITTABLE_PACKAGE_DURATIONS.has(d)
}
