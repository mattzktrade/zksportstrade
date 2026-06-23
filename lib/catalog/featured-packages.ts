import type { Package } from "@/lib/types/catalog"
import { pickFeaturedPackagesByStem } from "@/lib/catalog/season-rollover"

/** Curated dashboard highlights — ids must exist in the catalog. */
export const FEATURED_PACKAGE_IDS = [
  "monaco-velocity-terrace-sun-sat-2026",
  "singapore-national-gallery-vip-3days-2026",
  "abudhabi-marsa-box-3days-2026",
] as const

export type FeaturedPackageId = (typeof FEATURED_PACKAGE_IDS)[number]

/** Packages marked featured in admin (primary). Falls back to legacy curated ids when none flagged. */
export function pickFeaturedPackages(packages: Package[]): Package[] {
  const flagged = packages.filter((p) => p.featured === true)
  if (flagged.length > 0) return flagged
  return pickFeaturedPackagesByStem(FEATURED_PACKAGE_IDS, packages)
}

export function packageIsBookable(pkg: Package): boolean {
  if (typeof pkg.availability === "string" || pkg.price === null) return false
  return pkg.availability > 0
}

export function packageCheckoutHref(pkg: Package, guests = 1): string {
  return `/checkout?package=${encodeURIComponent(pkg.id)}&guests=${guests}`
}

export function packageDetailsHref(pkg: Package): string {
  if (pkg.raceId) {
    return `/packages/race/${pkg.raceId}?package=${encodeURIComponent(pkg.id)}`
  }
  return "/packages"
}
