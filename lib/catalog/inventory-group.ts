/**
 * Durations that participate in linked inventory for a product group.
 * Day tickets are independent pools; 2-day tracks min(Sat, Sun) and 3-day tracks min(Fri, Sat, Sun).
 */
export const SPLITTABLE_PACKAGE_DURATIONS = new Set([
  "3_day",
  "2_day",
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
])

/** Multi-day combo options constrained by their child single-day availability. */
export const MULTI_DAY_COMBO_DURATIONS = new Set(["2_day", "3_day"])

/** Suffixes stripped from package ids when deriving a shared inventory group key (longest first). */
const PACKAGE_ID_DURATION_SUFFIXES = [
  "-saturday-only",
  "-sunday-only",
  "-friday-only",
  "-thursday-only",
  "-sun-sat",
  "-sat-sun",
  "-3-days",
  "-3-day",
  "-3days",
  "-2-days",
  "-2-day",
  "-2day",
  "-saturday",
  "-sunday",
  "-friday",
  "-thursday",
] as const

/** Remove trailing season year, e.g. `-2026`. */
export function packageIdWithoutSeasonYear(packageId: string): string {
  return packageId.replace(/-\d{4}$/, "")
}

function collapseSlugHyphens(value: string): string {
  return value.replace(/-+/g, "-").replace(/^-+|-+$/g, "")
}

/** Product stem used to link split day options, e.g. `monaco-velocity-terrace`. */
export function packageInventoryStem(packageId: string): string {
  let stem = packageIdWithoutSeasonYear(packageId)

  for (const suffix of PACKAGE_ID_DURATION_SUFFIXES) {
    if (stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length)
      break
    }
  }

  stem = stem
    .replace(/-3-days?-/g, "-")
    .replace(/-3-days?$/g, "")
    .replace(/-3days-/g, "-")
    .replace(/-3days$/g, "")
    .replace(/-2-days?-/g, "-")
    .replace(/-2-days?$/g, "")

  return collapseSlugHyphens(stem)
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
  if (!stem) return null
  return `${raceId}/${stem}`
}

export function isSplittablePackageDuration(duration: string | null | undefined): boolean {
  const d = duration?.trim()
  return !!d && SPLITTABLE_PACKAGE_DURATIONS.has(d)
}

export function isMultiDayComboDuration(duration: string | null | undefined): boolean {
  const d = duration?.trim()
  return !!d && MULTI_DAY_COMBO_DURATIONS.has(d)
}
