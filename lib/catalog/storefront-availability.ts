import type { SupabaseClient } from "@supabase/supabase-js"
import { unstable_noStore as noStore } from "next/cache"
import { getCostLayerQuantityTotalsByPackage } from "@/lib/admin/cost-layers"
import {
  applyEffectiveSellable,
  emptyPackageSalesBreakdown,
  type EffectiveSellablePackage,
} from "@/lib/admin/package-sales-breakdown"
import { getPackageSalesBreakdownByPackage } from "@/lib/admin/package-sales-breakdown-queries"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Package } from "@/lib/types/catalog"

export type StorefrontPackageMeta = {
  id: string
  duration?: string | null
  inventory_group_id?: string | null
  shell_parent_package_id?: string | null
}

type InventoryQty = { qty_available: number; qty_held: number }

function storefrontClient(fallback: SupabaseClient): SupabaseClient {
  return createAdminClient() ?? fallback
}

function asMeta(row: StorefrontPackageMeta): StorefrontPackageMeta {
  return {
    id: row.id,
    duration: row.duration ?? null,
    inventory_group_id: row.inventory_group_id ?? null,
    shell_parent_package_id: row.shell_parent_package_id ?? null,
  }
}

/**
 * Remaining after purchased stock minus committed sales, including linked-suite
 * sibling SKUs and offline deals. Uses the service role when available so agent
 * sessions cannot miss sales they are not allowed to read.
 */
export async function effectiveSellableByPackageId(
  fallbackClient: SupabaseClient,
  packageMeta: StorefrontPackageMeta[],
): Promise<Map<string, number>> {
  noStore()
  const out = new Map<string, number>()
  if (packageMeta.length === 0) return out

  const supabase = storefrontClient(fallbackClient)
  const metaById = new Map(packageMeta.map((row) => [row.id, asMeta(row)]))
  const groupIds = [
    ...new Set(
      packageMeta
        .map((row) => row.inventory_group_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  if (groupIds.length > 0) {
    const { data: siblings } = await supabase
      .from("packages")
      .select("id, duration, inventory_group_id, shell_parent_package_id")
      .in("inventory_group_id", groupIds)
    for (const raw of siblings ?? []) {
      const row = raw as StorefrontPackageMeta
      if (!row.id || metaById.has(row.id)) continue
      metaById.set(row.id, asMeta(row))
    }
  }

  const allMeta = [...metaById.values()].filter((row) => !row.shell_parent_package_id)
  const ids = allMeta.map((row) => row.id)
  if (ids.length === 0) return out

  const [salesByPkg, layerTotals, inventoryResult] = await Promise.all([
    getPackageSalesBreakdownByPackage(ids, supabase),
    getCostLayerQuantityTotalsByPackage(ids, supabase),
    supabase.from("package_inventory").select("package_id, qty_available, qty_held").in("package_id", ids),
  ])

  const invBy = new Map<string, InventoryQty>()
  for (const raw of inventoryResult.data ?? []) {
    const row = raw as { package_id: string; qty_available: number; qty_held: number }
    if (!row.package_id) continue
    invBy.set(row.package_id, {
      qty_available: Number(row.qty_available ?? 0),
      qty_held: Number(row.qty_held ?? 0),
    })
  }

  const rows: EffectiveSellablePackage[] = allMeta.map((meta) => ({
    id: meta.id,
    duration: meta.duration ?? null,
    inventory_group_id: meta.inventory_group_id ?? null,
    shell_parent_package_id: meta.shell_parent_package_id ?? null,
    inventory: invBy.get(meta.id) ?? null,
    layer_units_purchased: layerTotals.get(meta.id)?.quantity_purchased ?? 0,
    sales_breakdown: salesByPkg.get(meta.id) ?? emptyPackageSalesBreakdown(meta.id),
  }))
  applyEffectiveSellable(rows)

  for (const row of rows) {
    out.set(row.id, Math.max(0, Math.floor(Number(row.effective_sellable) || 0)))
  }
  return out
}

/** Replace catalog `availability` with the same remaining figure admin Live qty uses. */
export async function attachStorefrontAvailability(
  fallbackClient: SupabaseClient,
  packages: Package[],
  packageMeta: StorefrontPackageMeta[],
): Promise<Package[]> {
  if (packages.length === 0) return packages
  const sellableById = await effectiveSellableByPackageId(fallbackClient, packageMeta)
  if (sellableById.size === 0) return packages
  return packages.map((pkg) => {
    if (typeof pkg.availability !== "number") return pkg
    const sellable = sellableById.get(pkg.id)
    if (sellable == null) return pkg
    return { ...pkg, availability: sellable }
  })
}
