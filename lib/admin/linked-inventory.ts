/** Client-safe — no server Supabase imports. */

import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import { emptyPackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"

export type LinkedInventoryPackage = {
  id: string
  name: string
  duration: string | null
  qty_available: number | null
  qty_held: number | null
  salesforce_product_id: string | null
  sales_breakdown: PackageSalesBreakdown
  /** Purchase ledger for this package (empty on linked days — stock lives on the 3-day). */
  cost_layers?: CostLayerRow[]
  /** Closed-won deal quantities assigned to cost layers (layer id → qty). */
  fulfilment_sold_by_layer?: Record<string, number>
}

/** Hidden Single Ticket shell — shown in linked inventory table only (not sellable). */
export type LinkedInventoryShellPackage = {
  id: string
  name: string
  duration: string | null
  salesforce_product_id: string | null
  sales_breakdown: PackageSalesBreakdown
}

export function linkedPackageSellable(pkg: Pick<LinkedInventoryPackage, "qty_available" | "qty_held">): number {
  const avail = pkg.qty_available ?? 0
  const held = pkg.qty_held ?? 0
  return Math.max(0, Math.floor(avail) - Math.floor(held))
}

type LinkedPackageSource = {
  id: string
  name: string
  duration?: string | null
  inventory_group_id?: string | null
  inventory: { qty_available: number; qty_held: number } | null
  sales_breakdown?: PackageSalesBreakdown
}

export function linkedPackagesFromAdminRows(
  pkg: Pick<LinkedPackageSource, "inventory_group_id">,
  all: LinkedPackageSource[],
): LinkedInventoryPackage[] {
  const groupId = pkg.inventory_group_id?.trim()
  if (!groupId) return []

  return all
    .filter((p) => p.inventory_group_id === groupId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      duration: p.duration ?? null,
      qty_available: p.inventory?.qty_available ?? null,
      qty_held: p.inventory?.qty_held ?? null,
      salesforce_product_id: (p as { salesforce_product_id?: string | null }).salesforce_product_id ?? null,
      sales_breakdown: p.sales_breakdown ?? emptyPackageSalesBreakdown(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
