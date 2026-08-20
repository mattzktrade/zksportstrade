import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import {
  emptyPackageSalesBreakdown,
  type PackageSalesBreakdown,
} from "@/lib/admin/package-sales-breakdown"

function addGuests(target: PackageSalesBreakdown, channel: string, guests: number): void {
  const qty = Math.max(0, Math.floor(guests))
  if (qty <= 0) return
  const normalized = channel.trim().toLowerCase()
  if (normalized === "wix" || normalized === "website") {
    target.wix += qty
  } else if (
    normalized === "offline" ||
    normalized === "admin" ||
    normalized === "other" ||
    normalized === "referral"
  ) {
    target.salesforceOffline += qty
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
  const IN_FILTER_BATCH = 80
  const ordersWithLines = new Set<string>()

  for (let i = 0; i < ids.length; i += IN_FILTER_BATCH) {
    const batch = ids.slice(i, i + IN_FILTER_BATCH)
    const { data: lines } = await supabase
      .from("order_line_items")
      .select("package_id, quantity, order_id, orders!inner(status, channel)")
      .in("package_id", batch)
      .neq("orders.status", "cancelled")

    for (const row of lines ?? []) {
      const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
      if (!pkgId) continue
      if (typeof row.order_id === "string" && row.order_id) ordersWithLines.add(row.order_id)
      const order = Array.isArray(row.orders) ? row.orders[0] : row.orders
      const channel = typeof order?.channel === "string" ? order.channel : "trade_portal"
      const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
      addGuests(breakdown, channel, Number(row.quantity))
      out.set(pkgId, breakdown)
    }
  }

  for (let i = 0; i < ids.length; i += IN_FILTER_BATCH) {
    const batch = ids.slice(i, i + IN_FILTER_BATCH)
    const { data: orders, error: orderErr } = await supabase
      .from("orders")
      .select("id, package_id, channel, guests")
      .in("package_id", batch)
      .neq("status", "cancelled")

    if (orderErr || !orders) continue
    for (const row of orders) {
      if (typeof row.id === "string" && ordersWithLines.has(row.id)) continue
      const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
      if (!pkgId) continue
      const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
      addGuests(breakdown, typeof row.channel === "string" ? row.channel : "trade_portal", Number(row.guests))
      out.set(pkgId, breakdown)
    }
  }

  const wanted = new Set(ids)
  const dealLines: Array<Record<string, unknown>> = []
  for (let i = 0; i < ids.length; i += IN_FILTER_BATCH) {
    const batch = ids.slice(i, i + IN_FILTER_BATCH)
    const { data } = await supabase
      .from("deal_line_items")
      .select("package_id, quantity, deals!inner(id, order_id, stage, source)")
      .in("package_id", batch)
    if (data) dealLines.push(...data)
  }

  const soldDealStages = new Set(["awaiting_payment", "paid_confirmed", "in_fulfilment", "fulfilled"])
  const pipelineDealStages = new Set([
    "draft",
    "sourcing",
    "proposal",
    "booking_form_sent",
    "awaiting_client_signature",
    "awaiting_zk_signature",
    "signed",
    "awaiting_invoice",
  ])

  for (const row of dealLines ?? []) {
    const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!pkgId || !wanted.has(pkgId)) continue
    const deal = Array.isArray(row.deals) ? row.deals[0] : row.deals
    if (!deal || deal.order_id) continue
    const stage = typeof deal.stage === "string" ? deal.stage : ""
    const source = typeof deal.source === "string" ? deal.source : "offline"
    const channel = source === "portal" ? "trade_portal" : source === "website" ? "wix" : "offline"
    const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
    if (soldDealStages.has(stage)) {
      addGuests(breakdown, channel, Number(row.quantity))
    } else if (pipelineDealStages.has(stage)) {
      breakdown.salesforceOpenPipeline += Math.max(0, Math.floor(Number(row.quantity) || 0))
    }
    out.set(pkgId, breakdown)
  }

  return out
}
