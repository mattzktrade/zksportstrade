import { unstable_noStore as noStore } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import {
  emptyPackageSalesBreakdown,
  type PackageSalesBreakdown,
} from "@/lib/admin/package-sales-breakdown"
import { dealStageCountsAsSold, dealStageIsUnsignedPipeline, dealStageReservesSellable } from "@/lib/crm/deal-types"
import { classifySalesChannel } from "@/lib/orders/channel"
import { fetchAllRows, mapChunks, POSTGREST_IN_FILTER_SIZE } from "@/lib/supabase/fetch-all-rows"

function addGuests(target: PackageSalesBreakdown, channel: string, guests: number): void {
  const qty = Math.max(0, Math.floor(guests))
  if (qty <= 0) return
  const bucket = classifySalesChannel(channel)
  if (bucket === "wix") {
    target.wix += qty
  } else if (bucket === "offline") {
    target.salesforceOffline += qty
  } else {
    target.tradePortal += qty
  }
  target.total += qty
}

type OrderEmbed = {
  status?: string | null
  channel?: string | null
  deal_id?: string | null
}

type DealEmbed = {
  id?: string | null
  order_id?: string | null
  stage?: string | null
  source?: string | null
}

type OrderLineRow = {
  id: string
  package_id: string | null
  quantity: number | null
  order_id: string | null
  orders: OrderEmbed | OrderEmbed[] | null
}

type OrderRow = {
  id: string
  package_id: string | null
  channel: string | null
  guests: number | null
  deal_id: string | null
}

type DealLineRow = {
  id: string
  package_id: string | null
  quantity: number | null
  deals: DealEmbed | DealEmbed[] | null
}

type DealHeadRow = {
  id: string
  order_id: string | null
  stage: string | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * PostgREST stops at 1000 rows and does not say so. A catalog batch of packages
 * can hold more deal lines than that, and the rows that fall off are simply
 * missing from Sold. Linked remaining then looks like the purchase is still free.
 */
async function loadInPages<T>(
  ids: readonly string[],
  loadPage: (
    batch: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks = await mapChunks([...ids], POSTGREST_IN_FILTER_SIZE, async (batch) => {
    const { data, error } = await fetchAllRows<T>((from, to) => loadPage(batch, from, to))
    if (error) {
      console.warn("[admin] package sales breakdown query failed:", error.message)
      return [] as T[]
    }
    return data
  })
  return chunks.flat()
}

export async function getPackageSalesBreakdown(packageId: string): Promise<PackageSalesBreakdown> {
  const map = await getPackageSalesBreakdownByPackage([packageId])
  return map.get(packageId) ?? emptyPackageSalesBreakdown(packageId)
}

export async function getPackageSalesBreakdownByPackage(
  packageIds: readonly string[],
  supabaseClient?: SupabaseClient,
): Promise<Map<string, PackageSalesBreakdown>> {
  noStore()
  const out = new Map<string, PackageSalesBreakdown>()
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return out

  for (const id of ids) {
    out.set(id, emptyPackageSalesBreakdown(id))
  }

  const supabase = supabaseClient ?? (await createClient())
  const ordersWithLines = new Set<string>()

  const [orderLines, orders, dealLines] = await Promise.all([
    loadInPages<OrderLineRow>(ids, (batch, from, to) =>
      supabase
        .from("order_line_items")
        .select("id, package_id, quantity, order_id, orders!inner(status, channel, deal_id)")
        .in("package_id", batch)
        .neq("orders.status", "cancelled")
        .order("id")
        .range(from, to),
    ),
    loadInPages<OrderRow>(ids, (batch, from, to) =>
      supabase
        .from("orders")
        .select("id, package_id, channel, guests, deal_id")
        .in("package_id", batch)
        .neq("status", "cancelled")
        .order("id")
        .range(from, to),
    ),
    loadInPages<DealLineRow>(ids, (batch, from, to) =>
      supabase
        .from("deal_line_items")
        .select("id, package_id, quantity, deals!inner(id, order_id, stage, source)")
        .in("package_id", batch)
        .order("id")
        .range(from, to),
    ),
  ])

  const orderIds = new Set<string>()
  const dealIds = new Set<string>()
  for (const row of orderLines) {
    if (typeof row.order_id === "string" && row.order_id) orderIds.add(row.order_id)
    const order = one(row.orders)
    if (typeof order?.deal_id === "string" && order.deal_id) dealIds.add(order.deal_id)
  }
  for (const row of orders) {
    if (typeof row.id === "string") orderIds.add(row.id)
    if (typeof row.deal_id === "string" && row.deal_id) dealIds.add(row.deal_id)
  }
  const withdrawn = await withdrawnSalesForDeals(supabase, [...orderIds], [...dealIds])

  for (const row of orderLines) {
    const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!pkgId) continue
    const order = one(row.orders)
    if (
      (typeof row.order_id === "string" && withdrawn.orderIds.has(row.order_id)) ||
      (typeof order?.deal_id === "string" && withdrawn.dealIds.has(order.deal_id))
    ) {
      continue
    }
    if (typeof row.order_id === "string" && row.order_id) {
      ordersWithLines.add(row.order_id)
    }
    const channel = typeof order?.channel === "string" ? order.channel : "trade_portal"
    const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
    addGuests(breakdown, channel, Number(row.quantity))
    out.set(pkgId, breakdown)
  }

  for (const row of orders) {
    if (
      typeof row.id === "string" &&
      (ordersWithLines.has(row.id) ||
        withdrawn.orderIds.has(row.id) ||
        (typeof row.deal_id === "string" && withdrawn.dealIds.has(row.deal_id)))
    ) {
      continue
    }
    const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!pkgId) continue
    const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
    addGuests(breakdown, typeof row.channel === "string" ? row.channel : "trade_portal", Number(row.guests))
    out.set(pkgId, breakdown)
  }

  const wanted = new Set(ids)
  for (const row of dealLines) {
    const pkgId = typeof row.package_id === "string" ? row.package_id.trim() : ""
    if (!pkgId || !wanted.has(pkgId)) continue
    const deal = one(row.deals)
    if (!deal || deal.order_id) continue
    const stage = typeof deal.stage === "string" ? deal.stage : ""
    const source = typeof deal.source === "string" ? deal.source : "offline"
    const channel = source === "portal" ? "trade_portal" : source === "website" ? "wix" : "offline"
    const breakdown = out.get(pkgId) ?? emptyPackageSalesBreakdown(pkgId)
    if (dealStageCountsAsSold(stage)) {
      addGuests(breakdown, channel, Number(row.quantity))
    } else if (dealStageReservesSellable(stage)) {
      breakdown.salesforceOpenPipeline += Math.max(0, Math.floor(Number(row.quantity) || 0))
    } else if (dealStageIsUnsignedPipeline(stage)) {
      breakdown.unsignedOpenPipeline += Math.max(0, Math.floor(Number(row.quantity) || 0))
    }
    out.set(pkgId, breakdown)
  }

  return out
}

async function withdrawnSalesForDeals(
  supabase: SupabaseClient,
  orderIds: string[],
  dealIds: string[],
): Promise<{ orderIds: Set<string>; dealIds: Set<string> }> {
  const hiddenOrders = new Set<string>()
  const hiddenDeals = new Set<string>()
  if (orderIds.length === 0 && dealIds.length === 0) {
    return { orderIds: hiddenOrders, dealIds: hiddenDeals }
  }

  const mark = (rows: DealHeadRow[]) => {
    for (const row of rows) {
      if (row.stage !== "cancelled" && row.stage !== "closed_lost") continue
      hiddenDeals.add(String(row.id))
      if (row.order_id) hiddenOrders.add(String(row.order_id))
    }
  }

  const [byOrder, byDeal] = await Promise.all([
    loadInPages<DealHeadRow>(orderIds, (batch, from, to) =>
      supabase.from("deals").select("id, order_id, stage").in("order_id", batch).order("id").range(from, to),
    ),
    loadInPages<DealHeadRow>(dealIds, (batch, from, to) =>
      supabase.from("deals").select("id, order_id, stage").in("id", batch).order("id").range(from, to),
    ),
  ])
  mark(byOrder)
  mark(byDeal)
  return { orderIds: hiddenOrders, dealIds: hiddenDeals }
}
