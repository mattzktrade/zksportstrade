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

/** Prefixes stripped from generated ids when the day label appears before the product name. */
const PACKAGE_ID_DURATION_PREFIXES = [
  "saturday-sunday-",
  "sunday-saturday-",
  "sat-sun-",
  "sun-sat-",
  "saturday-only-",
  "sunday-only-",
  "friday-only-",
  "thursday-only-",
  "saturday-",
  "sunday-",
  "friday-",
  "thursday-",
  "3-days-",
  "3-day-",
  "3days-",
  "2-days-",
  "2-day-",
  "2day-",
] as const

/** Remove trailing season year, e.g. `-2026`. */
export function packageIdWithoutSeasonYear(packageId: string): string {
  return packageId.replace(/-\d{4}$/, "")
}

function collapseSlugHyphens(value: string): string {
  return value.replace(/-+/g, "-").replace(/^-+|-+$/g, "")
}

/** Leading `{slug}-{year}` on a package id or inventory stem, e.g. `australia-2026`. */
export function leadingRaceIdFromSlug(value: string): string | null {
  const match = value.trim().toLowerCase().match(/^([a-z0-9]+(?:-[a-z0-9]+)*-\d{4})(?=-|$)/)
  return match?.[1] ?? null
}

/** Race id stored before `/` on a linked-inventory key, or a leading `{slug}-{year}` stem. */
export function inventoryGroupRaceId(groupId: string | null | undefined): string | null {
  const trimmed = groupId?.trim() ?? ""
  if (!trimmed) return null
  const slash = trimmed.indexOf("/")
  if (slash > 0) return trimmed.slice(0, slash)
  return leadingRaceIdFromSlug(trimmed)
}

/** Rewrite a product stem so its race-year prefix matches the package's current event. */
export function retargetInventoryStemToRace(stem: string, raceId: string): string {
  const trimmedStem = collapseSlugHyphens(stem)
  const trimmedRace = raceId.trim()
  if (!trimmedStem || !trimmedRace) return trimmedStem
  const oldRace = leadingRaceIdFromSlug(trimmedStem)
  if (!oldRace || oldRace === trimmedRace) return trimmedStem
  if (trimmedStem === oldRace) return trimmedRace
  return collapseSlugHyphens(trimmedRace + trimmedStem.slice(oldRace.length))
}

/**
 * Move a linked-inventory key onto another race, keeping the product stem.
 * `australia-2026/australia-2026-paddock-club-mercedes` + `abu-dhabi-2026`
 * → `abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes`
 */
export function retargetInventoryGroupToRace(groupId: string, raceId: string): string {
  const trimmed = groupId.trim()
  const newRace = raceId.trim()
  if (!trimmed || !newRace) return trimmed
  const slash = trimmed.indexOf("/")
  const stem = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const nextStem = retargetInventoryStemToRace(stem, newRace)
  if (!nextStem) return newRace
  return `${newRace}/${nextStem}`
}

export function inventoryGroupMatchesRace(
  groupId: string | null | undefined,
  raceId: string | null | undefined,
): boolean {
  const groupRace = inventoryGroupRaceId(groupId)
  const race = raceId?.trim() ?? ""
  if (!groupRace || !race) return true
  return groupRace === race
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

  const racePrefixMatch = stem.match(/^(.+-\d{4}-)(.+)$/)
  const prefixBase = racePrefixMatch?.[1] ?? ""
  let namePart = racePrefixMatch?.[2] ?? stem
  for (const prefix of PACKAGE_ID_DURATION_PREFIXES) {
    if (namePart.startsWith(prefix)) {
      namePart = namePart.slice(prefix.length)
      break
    }
  }
  stem = `${prefixBase}${namePart}`

  return collapseSlugHyphens(stem)
}

/** Group id for split packages at the same race (links cascade rules in the database). */
export function deriveInventoryGroupId(
  packageId: string,
  duration: string | null | undefined,
  raceId: string,
): string | null {
  const d = duration?.trim()
  const race = raceId.trim()
  if (!d || !SPLITTABLE_PACKAGE_DURATIONS.has(d) || !race) return null
  const stem = retargetInventoryStemToRace(packageInventoryStem(packageId), race)
  if (!stem) return null
  return `${race}/${stem}`
}

/**
 * Linked-inventory key to persist for a package.
 * Same-race custom keys are kept (Sat/Sun joining a 3-day). Keys that still
 * point at another race are rewritten onto this event so changing Australia →
 * Abu Dhabi cannot keep sharing Australia stock.
 */
export function resolveInventoryGroupId(input: {
  packageId: string
  duration: string | null | undefined
  raceId: string
  inventoryIsStandalone?: boolean
  manualGroupId?: string | null
}): string | null {
  if (input.inventoryIsStandalone) return null
  const raceId = input.raceId.trim()
  const derived = deriveInventoryGroupId(input.packageId, input.duration, raceId)
  if (!derived) return null
  const manual = input.manualGroupId?.trim() || null
  if (!manual) return derived
  const manualRace = inventoryGroupRaceId(manual)
  if (!manualRace || manualRace === raceId) return manual
  return retargetInventoryGroupToRace(manual, raceId)
}

export function isSplittablePackageDuration(duration: string | null | undefined): boolean {
  const d = duration?.trim()
  return !!d && SPLITTABLE_PACKAGE_DURATIONS.has(d)
}

export function isMultiDayComboDuration(duration: string | null | undefined): boolean {
  const d = duration?.trim()
  return !!d && MULTI_DAY_COMBO_DURATIONS.has(d)
}
