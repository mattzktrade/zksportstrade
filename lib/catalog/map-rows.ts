import type { Package, Race } from "@/lib/types/catalog"

type DbRace = {
  id: string
  name: string
  short_name: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  image: string
  season: number
}

type DbPackage = {
  id: string
  race_id: string
  name: string
  circuit: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  trade_price: number | null
  currency: string
  total_capacity: number
  is_enquiry: boolean
  image: string | null
  tier: string
  duration?: string | null
  includes: unknown
  featured: boolean
  sort_order: number
  brochure_url?: string | null
  description?: string | null
  gallery_images?: unknown
}

function parseGalleryImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x === "string" && x.trim().length > 0) out.push(x.trim())
  }
  return out
}

type DbInventory = {
  package_id: string
  qty_available: number
  qty_held: number
}

export function mapPackageRow(p: DbPackage, inv: DbInventory | undefined): Package {
  const includes = Array.isArray(p.includes) ? (p.includes as string[]) : []
  const price = p.trade_price != null ? Number(p.trade_price) : null
  const tier = (["paddock", "champions", "legend", "hero"].includes(p.tier) ? p.tier : "paddock") as Package["tier"]
  const durationRaw = typeof p.duration === "string" && p.duration.trim() ? p.duration.trim() : null
  const brochureRaw = p.brochure_url
  const brochureUrl =
    typeof brochureRaw === "string" && brochureRaw.trim().length > 0 ? brochureRaw.trim() : null
  const description = typeof p.description === "string" ? p.description : ""
  const galleryImages = parseGalleryImages(p.gallery_images)

  if (p.is_enquiry) {
  return {
    id: p.id,
    name: p.name,
    circuit: p.circuit,
    location: p.location,
    country: p.country,
    countryCode: p.country_code,
    date: p.event_date,
    dateRange: p.date_range,
    price,
    currency: p.currency,
    availability: "Enquire",
    totalCapacity: p.total_capacity,
    image: p.image ?? "/placeholder.svg",
    tier,
    duration: durationRaw,
    includes,
    description: description.trim() ? description : null,
    galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
    featured: p.featured,
    brochureUrl,
    raceId: p.race_id,
  }
  }

  const qtyAvailable = inv?.qty_available ?? 0
  const qtyHeld = inv?.qty_held ?? 0
  const sellable = Math.max(0, qtyAvailable - qtyHeld)

  return {
    id: p.id,
    name: p.name,
    circuit: p.circuit,
    location: p.location,
    country: p.country,
    countryCode: p.country_code,
    date: p.event_date,
    dateRange: p.date_range,
    price,
    currency: p.currency,
    availability: sellable,
    totalCapacity: p.total_capacity,
    image: p.image ?? "/placeholder.svg",
    tier,
    duration: durationRaw,
    includes,
    description: description.trim() ? description : null,
    galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
    featured: p.featured,
    brochureUrl,
    raceId: p.race_id,
  }
}

export function mapRaceRow(r: DbRace, packages: Package[]): Race {
  const racePackages = packages.filter((pkg) => pkg.date === r.event_date || pkg.circuit.includes(r.short_name))
  const validPrices = racePackages.map((p) => p.price).filter((p): p is number => p !== null && p > 0)
  const lowestPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0

  return {
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    location: r.location,
    country: r.country,
    countryCode: r.country_code,
    date: r.event_date,
    dateRange: r.date_range,
    image: r.image,
    packagesAvailable: racePackages.length,
    lowestPrice,
  }
}

export function buildCatalog(raceRows: DbRace[], packageRows: DbPackage[], inventoryRows: DbInventory[]) {
  const invByPackage = new Map(inventoryRows.map((i) => [i.package_id, i]))
  const packages: Package[] = packageRows.map((p) => mapPackageRow(p, invByPackage.get(p.id)))

  const races: Race[] = raceRows.map((r) => mapRaceRow(r, packages))

  return { races, packages }
}

export type { DbRace, DbPackage, DbInventory }
