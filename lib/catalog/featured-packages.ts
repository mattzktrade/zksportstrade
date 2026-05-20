import type { Package } from "@/lib/types/catalog"
import { featuredTaglineForPackage, pickFeaturedPackagesByStem } from "@/lib/catalog/season-rollover"

/** Curated dashboard highlights — ids must exist in the catalog. */
export const FEATURED_PACKAGE_IDS = [
  "monaco-velocity-terrace-sun-sat-2026",
  "singapore-national-gallery-vip-3days-2026",
  "abudhabi-marsa-box-3days-2026",
] as const

export type FeaturedPackageId = (typeof FEATURED_PACKAGE_IDS)[number]

const FEATURED_TAGLINES: Record<FeaturedPackageId, string> = {
  "monaco-velocity-terrace-sun-sat-2026": "Saturday & Sunday terrace hospitality on the harbour",
  "singapore-national-gallery-vip-3days-2026": "Three-day VIP at the National Gallery",
  "abudhabi-marsa-box-3days-2026": "Exclusive ZK Marsa Box across the full race weekend",
}

export function featuredPackageTagline(packageId: string): string | null {
  return featuredTaglineForPackage(packageId, FEATURED_TAGLINES)
}

/** Resolves featured templates to the active season’s package ids (e.g. 2027 after 2026 ends). */
export function pickFeaturedPackages(packages: Package[]): Package[] {
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
