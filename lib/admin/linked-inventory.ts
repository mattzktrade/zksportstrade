/** Client-safe — no server Supabase imports. */

import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import { emptyPackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"

export type LinkedInventoryPackage = {
  id: string
  name: string
  duration: string | null
  qty_available: number | null
  qty_held: number | null
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
      sales_breakdown: p.sales_breakdown ?? emptyPackageSalesBreakdown(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
