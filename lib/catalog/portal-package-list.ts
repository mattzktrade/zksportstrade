import {
  inferPackageDurationFromName,
  isValidPackageDuration,
  packageDurationTitlePrefix,
  type PackageDurationValue,
} from "@/lib/catalog/package-duration"
import type { Package } from "@/lib/types/catalog"

const TEAM_SUFFIX =
  /\s*[-–:]\s*(ferrari|mercedes(?:-amg)?|aston martin|red bull(?: racing)?|mclaren|alpine|williams|haas|sauber|kick sauber|racing bulls|visa cash app|alphatauri|\brb\b)\b.*$/i

const DURATION_RANK: Record<string, number> = {
  "3_day": 0,
  "2_day": 1,
  thursday_only: 2,
  friday_only: 3,
  saturday_only: 4,
  sunday_only: 5,
}

export type PortalPackageGroup = {
  family: string
  packages: Package[]
}

function stripDurationPrefix(name: string): string {
  return name
    .trim()
    .replace(/^\d+\s*days?\s+/i, "")
    .replace(
      /^(thursday|friday|saturday|sunday)(?:\s*(?:&|and)\s*(thursday|friday|saturday|sunday))?\s+/i,
      "",
    )
    .replace(/\s*\((?:thursday|friday|saturday|sunday)[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isPaddockClubFamily(name: string): boolean {
  const n = name.toLowerCase()
  if (/f1\s*experiences/.test(n) && /\blounge\b/.test(n)) return false
  if (/paddock\s*club/.test(n)) return true
  if (/house\s*44/.test(n)) return true
  if (/f1\s*experiences/.test(n)) return true
  return false
}

/** Shared listing group, e.g. Saturday / 3 Day Velocity Terrace → "Velocity Terrace". */
export function portalPackageFamily(name: string): string {
  const raw = name.trim()
  if (isPaddockClubFamily(raw)) return "Paddock Club"
  let family = stripDurationPrefix(raw)
  family = family.replace(TEAM_SUFFIX, "").replace(/\s+/g, " ").trim()
  return family || raw
}

export function portalPackageDurationKey(pkg: Pick<Package, "name" | "duration">): PackageDurationValue | "" {
  const stored = pkg.duration?.trim() ?? ""
  if (stored && isValidPackageDuration(stored)) return stored as PackageDurationValue
  return inferPackageDurationFromName(pkg.name)
}

export function portalPackageIsInStock(pkg: Pick<Package, "availability">): boolean {
  if (typeof pkg.availability === "string") return true
  return pkg.availability > 0
}

/**
 * Guest-facing stock. A real zero (or less) stays unbookable, but reads as
 * Enquire so agents can still ask rather than seeing a sold-out count.
 */
export function portalStockLabel(availability: number | string): string {
  if (typeof availability === "string") {
    const text = availability.trim()
    return text || "Enquire"
  }
  if (!Number.isFinite(availability) || availability <= 0) return "Enquire"
  return String(Math.floor(availability))
}

function familyRank(family: string): number {
  const n = family.toLowerCase()
  if (/paddock club/.test(n)) return 10
  if (/champions club/.test(n)) return 25
  if (/\bclub\b/.test(n)) return 40
  if (/lounge|suite|terrace|deck/.test(n)) return 50
  if (/grandstand|straight|tickets/.test(n)) return 80
  return 60
}

function comparePackages(a: Package, b: Package): number {
  const stock = Number(portalPackageIsInStock(b)) - Number(portalPackageIsInStock(a))
  if (stock !== 0) return stock
  const duration =
    (DURATION_RANK[portalPackageDurationKey(a)] ?? 9) - (DURATION_RANK[portalPackageDurationKey(b)] ?? 9)
  if (duration !== 0) return duration
  const priceA = a.price ?? Number.POSITIVE_INFINITY
  const priceB = b.price ?? Number.POSITIVE_INFINITY
  if (priceA !== priceB) return priceA - priceB
  return a.name.localeCompare(b.name)
}

export function sortPortalPackages(packages: Package[]): Package[] {
  return [...packages].sort((a, b) => {
    const familyCmp = familyRank(portalPackageFamily(a.name)) - familyRank(portalPackageFamily(b.name))
    if (familyCmp !== 0) return familyCmp
    const familyName = portalPackageFamily(a.name).localeCompare(portalPackageFamily(b.name))
    if (familyName !== 0) return familyName
    return comparePackages(a, b)
  })
}

export function groupPortalPackages(packages: Package[]): PortalPackageGroup[] {
  const sorted = sortPortalPackages(packages)
  const groups: PortalPackageGroup[] = []
  for (const pkg of sorted) {
    const family = portalPackageFamily(pkg.name)
    const last = groups[groups.length - 1]
    if (last && last.family === family) {
      last.packages.push(pkg)
    } else {
      groups.push({ family, packages: [pkg] })
    }
  }
  return groups
}

export function filterPortalPackages(
  packages: Package[],
  opts: { query: string; inStockOnly: boolean; duration: string; family: string },
): Package[] {
  const query = opts.query.trim().toLowerCase()
  return packages.filter((pkg) => {
    if (opts.inStockOnly && !portalPackageIsInStock(pkg)) return false
    const duration = portalPackageDurationKey(pkg)
    if (opts.duration && duration !== opts.duration) return false
    const family = portalPackageFamily(pkg.name)
    if (opts.family && family !== opts.family) return false
    if (!query) return true
    const haystack = [pkg.name, family, packageDurationTitlePrefix(duration) ?? "", pkg.circuit]
      .join(" ")
      .toLowerCase()
    return haystack.includes(query)
  })
}

export function portalPackageDurationFilters(packages: Package[]): Array<{ value: string; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ value: string; label: string }> = []
  for (const pkg of sortPortalPackages(packages)) {
    const key = portalPackageDurationKey(pkg)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ value: key, label: packageDurationTitlePrefix(key) ?? key })
  }
  return out
}

export function portalPackageFamilyFilters(packages: Package[]): string[] {
  return groupPortalPackages(packages).map((group) => group.family)
}
