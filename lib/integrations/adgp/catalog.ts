import { effectiveSellableByPackageId } from "@/lib/catalog/storefront-availability"
import { isContactOnlySlug } from "@/lib/integrations/adgp/config"
import type { AdgpCatalogItem } from "@/lib/integrations/adgp/types"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * ADGP public price is a number staff already set on the CRM package:
 * `wix_retail_price` when locked, otherwise `trade_price`.
 * Do not apply the Wix 1.10 markup here — that produced half-dollar figures
 * that do not match the catalog.
 */
export function adgpUnitPrice(
  tradePrice: number | null | undefined,
  _packageOverride?: number | null,
  manualRetailPrice?: number | null,
): number | null {
  if (manualRetailPrice != null && Number.isFinite(manualRetailPrice) && manualRetailPrice > 0) {
    return Math.round(manualRetailPrice)
  }
  if (tradePrice == null || !Number.isFinite(tradePrice)) return null
  if (tradePrice < 0) return null
  return Math.round(tradePrice)
}

type MapRow = {
  slug: string
  day: string
  package_id: string
  enabled: boolean
}

type PackageRow = {
  id: string
  name: string
  currency: string | null
  trade_price: number | null
  retail_price_multiplier: number | null
  wix_retail_price: number | null
  is_enquiry: boolean | null
  is_hidden: boolean | null
  duration: string | null
  inventory_group_id: string | null
  shell_parent_package_id: string | null
}

export async function loadAdgpCatalog(): Promise<
  { ok: true; items: AdgpCatalogItem[] } | { ok: false; message: string }
> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  const { data: maps, error: mapError } = await admin
    .from("adgp_package_map")
    .select("slug, day, package_id, enabled")
    .eq("enabled", true)
  if (mapError) return { ok: false, message: mapError.message }

  const rows = ((maps ?? []) as MapRow[]).filter((row) => !isContactOnlySlug(row.slug))
  const packageIds = [...new Set(rows.map((row) => row.package_id))]
  if (packageIds.length === 0) return { ok: true, items: [] }

  const { data: packages, error: pkgError } = await admin
    .from("packages")
    .select(
      "id, name, currency, trade_price, retail_price_multiplier, wix_retail_price, is_enquiry, is_hidden, duration, inventory_group_id, shell_parent_package_id",
    )
    .in("id", packageIds)
  if (pkgError) return { ok: false, message: pkgError.message }

  const byId = new Map(((packages ?? []) as PackageRow[]).map((row) => [row.id, row]))
  const sellable = await effectiveSellableByPackageId(
    admin,
    [...byId.values()].map((row) => ({
      id: row.id,
      duration: row.duration,
      inventory_group_id: row.inventory_group_id,
      shell_parent_package_id: row.shell_parent_package_id,
    })),
  )

  const items: AdgpCatalogItem[] = []
  for (const map of rows) {
    const pkg = byId.get(map.package_id)
    if (!pkg) continue
    const remaining = Math.max(0, Math.floor(sellable.get(pkg.id) ?? 0))
    const unitPrice = adgpUnitPrice(pkg.trade_price, pkg.retail_price_multiplier, pkg.wix_retail_price)
    const enquiry = Boolean(pkg.is_enquiry)
    const hidden = Boolean(pkg.is_hidden)
    const priced = unitPrice != null && unitPrice > 0
    let reason: string | null = null
    if (hidden) reason = "hidden"
    else if (enquiry) reason = "enquiry_only"
    else if (!priced) reason = "price_missing"
    else if (remaining <= 0) reason = "sold_out"
    items.push({
      slug: map.slug,
      day: map.day,
      packageId: pkg.id,
      name: pkg.name,
      currency: (pkg.currency ?? "USD").trim() || "USD",
      unitPrice: priced ? unitPrice : 0,
      sellable: remaining,
      buyable: !reason,
      reason,
    })
  }
  return { ok: true, items }
}

export function catalogItemFor(
  items: AdgpCatalogItem[],
  slug: string,
  day: string,
): AdgpCatalogItem | null {
  return items.find((item) => item.slug === slug && item.day === day) ?? null
}
