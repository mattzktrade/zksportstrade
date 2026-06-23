import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import {
  emptyPackageSalesBreakdown,
  type PackageSalesBreakdown,
} from "@/lib/admin/package-sales-breakdown"

function addGuests(target: PackageSalesBreakdown, channel: string, guests: number): void {
  const qty = Math.max(0, Math.floor(guests))
  if (qty <= 0) return
  if (channel === "wix") {
    target.wix += qty
  } else {
    target.tradePortal += qty
  }
  target.total += qty
}

export async function getPackageSalesBreakdown(packageId: string): Promise<PackageSalesBreakdown> {
  const map = await getPackageSalesBreakdownByPackage([packageId])
  return map.get(packageId) ?? emptyPackageSalesBreakdown(packageId)
}

export async function getPackageSalesBreakdownByPackage(
  packageIds: readonly string[],
): Promise<Map<string, PackageSalesBreakdown>> {
  noStore()
  const out = new Map<string, PackageSalesBreakdown>()
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return out

  for (const id of ids) {
    out.set(id, emptyPackageSalesBreakdown(id))
  }

  const supabase = await createClient()

  const { data: orders, error: orderErr } = await supabase
    .from("orders")
    .select("package_id, channel, guests")
    .in("package_id", ids)
    .neq("status", "cancelled")

  if (!orderErr && orders) {
    for (const row of orders) {
      const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
      if (!pkgId) continue
      const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
      addGuests(breakdown, typeof row.channel === "string" ? row.channel : "trade_portal", Number(row.guests))
      out.set(pkgId, breakdown)
    }
  }

  const { data: sfRows, error: sfErr } = await supabase
    .from("salesforce_offline_sale_applications")
    .select("package_id, quantity")
    .in("package_id", ids)

  if (!sfErr && sfRows) {
    for (const row of sfRows) {
      const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
      if (!pkgId) continue
      const qty = Math.max(0, Math.floor(Number(row.quantity) || 0))
      if (qty <= 0) continue
      const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
      breakdown.salesforceOffline += qty
      breakdown.total += qty
      out.set(pkgId, breakdown)
    }
  }

  return out
}
