import type { SupabaseClient } from "@supabase/supabase-js"
import { PACKAGE_COLUMNS } from "@/lib/catalog/columns"
import { toDisplayImageUrl } from "@/lib/images/display-image-url"
import { retailPriceFromTrade } from "@/lib/integrations/retail-price"

export type CatalogListingEvent = {
  raceId: string | null
  raceName: string | null
  season: number | null
  circuit: string | null
  location: string | null
  country: string | null
  eventDate: string | null
  dateRange: string | null
}

export type CatalogListingPricing = {
  tradePrice: number | null
  currency: string
  retailPrice: number | null
  isEnquiry: boolean
}

export type CatalogListingChannels = {
  sellOnTradePortal: boolean
  sellOnWix: boolean
  sellOnPartners: boolean
}

/** Canonical listing snapshot for Salesforce, Wix (Phase 4), and partner API. */
export type CatalogListingPayload = {
  packageId: string
  productCode: string | null
  name: string
  description: string | null
  includes: string[]
  imageUrl: string | null
  galleryUrls: string[]
  brochureUrl: string | null
  tier: string | null
  duration: string | null
  event: CatalogListingEvent
  pricing: CatalogListingPricing
  channels: CatalogListingChannels
}

type PackageListingRow = {
  id: string
  name: string
  description: string | null
  product_code: string | null
  trade_price: number | null
  currency: string
  is_enquiry: boolean
  race_id: string | null
  circuit: string | null
  location: string | null
  country: string | null
  event_date: string | null
  date_range: string | null
  image: string | null
  gallery_images: unknown
  includes: unknown
  brochure_url: string | null
  tier: string | null
  duration: string | null
  retail_price_multiplier: number | null
  wix_retail_price: number | null
  sell_on_trade_portal: boolean
  sell_on_wix: boolean
  sell_on_partners: boolean
}

function appOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`
  return null
}

/** HTTPS URL suitable for external systems (Salesforce URL fields, Wix). */
export function resolvePublicCatalogImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const trimmed = url.trim()
  if (trimmed.startsWith("https://")) {
    return toDisplayImageUrl(trimmed, { variant: "hero" })
  }
  if (trimmed.startsWith("/")) {
    const base = appOrigin()
    if (!base) return null
    return toDisplayImageUrl(`${base}${trimmed}`, { variant: "hero" })
  }
  return null
}

export function normalizeIncludesList(includes: unknown): string[] {
  if (!Array.isArray(includes)) return []
  return includes.map((item) => String(item).trim()).filter(Boolean)
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** HTML list for Salesforce Rich Text (`Inclusions__c`); renders correctly in Lightning. */
export function formatIncludesForSalesforce(includes: string[]): string {
  if (includes.length === 0) return ""
  const items = includes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
  return `<ul>${items}</ul>`.slice(0, 32000)
}

export function formatGalleryForSalesforce(urls: string[]): string {
  if (urls.length === 0) return ""
  return urls.join("\n").slice(0, 32000)
}

export async function buildCatalogListingPayload(
  admin: SupabaseClient,
  packageId: string,
): Promise<CatalogListingPayload> {
  const { data: pkg, error } = await admin.from("packages").select(PACKAGE_COLUMNS).eq("id", packageId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!pkg) throw new Error(`Package ${packageId} not found.`)

  const row = pkg as PackageListingRow

  let raceName: string | null = null
  let season: number | null = null
  if (row.race_id) {
    const { data: race } = await admin
      .from("races")
      .select("name, season")
      .eq("id", row.race_id)
      .maybeSingle()
    raceName = (race as { name?: string } | null)?.name?.trim() ?? null
    const seasonVal = (race as { season?: number } | null)?.season
    season = typeof seasonVal === "number" ? seasonVal : null
  }

  const includes = normalizeIncludesList(row.includes)
  const galleryUrls = (Array.isArray(row.gallery_images) ? row.gallery_images : [])
    .map((u) => resolvePublicCatalogImageUrl(String(u)))
    .filter((u): u is string => Boolean(u))

  const tradePrice =
    row.trade_price != null && !row.is_enquiry && Number.isFinite(Number(row.trade_price))
      ? Number(row.trade_price)
      : null

  return {
    packageId: row.id,
    productCode: row.product_code?.trim() || null,
    name: row.name.trim(),
    description: typeof row.description === "string" ? row.description.trim() || null : null,
    includes,
    imageUrl: resolvePublicCatalogImageUrl(row.image),
    galleryUrls,
    brochureUrl: resolvePublicCatalogImageUrl(row.brochure_url),
    tier: row.tier?.trim() || null,
    duration: row.duration?.trim() || null,
    event: {
      raceId: row.race_id,
      raceName,
      season,
      circuit: row.circuit?.trim() || null,
      location: row.location?.trim() || null,
      country: row.country?.trim() || null,
      eventDate: row.event_date,
      dateRange: row.date_range?.trim() || null,
    },
    pricing: {
      tradePrice,
      currency: (row.currency ?? "USD").trim() || "USD",
      retailPrice: retailPriceFromTrade(tradePrice, row.retail_price_multiplier, row.wix_retail_price),
      isEnquiry: Boolean(row.is_enquiry),
    },
    channels: {
      sellOnTradePortal: row.sell_on_trade_portal !== false,
      sellOnWix: Boolean(row.sell_on_wix),
      sellOnPartners: Boolean(row.sell_on_partners),
    },
  }
}
