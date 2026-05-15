import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export type CostLayerRow = {
  id: string
  package_id: string
  quantity: number
  quantity_remaining: number
  unit_cost: number
  currency: string
  note: string | null
  received_at: string
  created_at: string
  updated_at: string
}

export type CostConsumptionRow = {
  id: string
  order_id: string
  cost_layer_id: string | null
  package_id: string
  quantity: number
  unit_cost: number | null
  currency: string
  created_at: string
}

export type PackageCostSummary = {
  package_id: string
  /** Weighted average unit_cost across all layers with quantity_remaining > 0. */
  weighted_unit_cost: number | null
  /** Sum of quantity_remaining across layers. Used to detect layer/inventory desync. */
  layer_units_remaining: number
  /** True when the package has any layer with unit_cost = 0 (often legacy backfill). */
  has_zero_cost_layer: boolean
  /** True when any active layer's currency differs from the package currency. */
  has_currency_mismatch: boolean
  /** Currency of the layers (the package's currency is the source of truth). */
  currency: string
}

export type OrderCostSummary = {
  order_id: string
  /** Per-unit weighted cost based on layered consumption. Null when any unit lacks a cost basis. */
  weighted_unit_cost: number | null
  /** Total COGS for the order (sum of qty * unit_cost), null when any unit lacks cost basis. */
  cogs: number | null
  /** True when any consumption row has unit_cost = NULL (un-priced shortfall). */
  cost_known: boolean
  /** True when consumption currencies don't all match the order currency. */
  currency_consistent: boolean
  /** Number of units across consumption rows (should equal order.guests when consistent). */
  unit_count: number
}

const COST_LAYER_COLUMNS =
  "id, package_id, quantity, quantity_remaining, unit_cost, currency, note, received_at, created_at, updated_at" as const

const CONSUMPTION_COLUMNS =
  "id, order_id, cost_layer_id, package_id, quantity, unit_cost, currency, created_at" as const

function n(value: number | string | null | undefined): number {
  if (value == null) return 0
  return typeof value === "number" ? value : Number(value)
}

function nNullable(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const x = typeof value === "number" ? value : Number(value)
  return Number.isFinite(x) ? x : null
}

export async function getCostLayersForPackage(packageId: string): Promise<CostLayerRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("package_cost_layers")
    .select(COST_LAYER_COLUMNS)
    .eq("package_id", packageId)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
  if (error || !data) return []
  return data.map((row) => ({
    ...(row as CostLayerRow),
    quantity: Math.floor(n((row as CostLayerRow).quantity)),
    quantity_remaining: Math.floor(n((row as CostLayerRow).quantity_remaining)),
    unit_cost: n((row as CostLayerRow).unit_cost),
  }))
}

export async function getCostLayersByPackage(
  packageIds: readonly string[],
): Promise<Map<string, CostLayerRow[]>> {
  const out = new Map<string, CostLayerRow[]>()
  if (packageIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("package_cost_layers")
    .select(COST_LAYER_COLUMNS)
    .in("package_id", packageIds)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
  if (error || !data) return out
  for (const raw of data) {
    const row = raw as CostLayerRow
    const list = out.get(row.package_id) ?? []
    list.push({
      ...row,
      quantity: Math.floor(n(row.quantity)),
      quantity_remaining: Math.floor(n(row.quantity_remaining)),
      unit_cost: n(row.unit_cost),
    })
    out.set(row.package_id, list)
  }
  return out
}

export function summarizePackageCost(
  packageCurrency: string,
  layers: CostLayerRow[],
): PackageCostSummary | null {
  if (layers.length === 0) {
    return {
      package_id: "",
      weighted_unit_cost: null,
      layer_units_remaining: 0,
      has_zero_cost_layer: false,
      has_currency_mismatch: false,
      currency: packageCurrency,
    }
  }
  let costTotal = 0
  let units = 0
  let hasZero = false
  let mismatch = false
  for (const l of layers) {
    if (l.quantity_remaining > 0) {
      costTotal += l.unit_cost * l.quantity_remaining
      units += l.quantity_remaining
    }
    if (l.unit_cost === 0) hasZero = true
    if (l.currency !== packageCurrency) mismatch = true
  }
  return {
    package_id: layers[0].package_id,
    weighted_unit_cost: units > 0 ? costTotal / units : null,
    layer_units_remaining: units,
    has_zero_cost_layer: hasZero,
    has_currency_mismatch: mismatch,
    currency: packageCurrency,
  }
}

export async function getConsumptionsForOrders(
  orderIds: readonly string[],
): Promise<Map<string, CostConsumptionRow[]>> {
  noStore()
  const out = new Map<string, CostConsumptionRow[]>()
  if (orderIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("order_cost_consumptions")
    .select(CONSUMPTION_COLUMNS)
    .in("order_id", orderIds)
  if (error || !data) return out
  for (const raw of data) {
    const row = raw as CostConsumptionRow
    const list = out.get(row.order_id) ?? []
    list.push({
      ...row,
      quantity: Math.floor(n(row.quantity)),
      unit_cost: nNullable(row.unit_cost),
    })
    out.set(row.order_id, list)
  }
  return out
}

export function summarizeOrderCost(
  orderCurrency: string,
  consumptions: readonly CostConsumptionRow[] | undefined,
  expectedUnits?: number,
): OrderCostSummary {
  if (!consumptions || consumptions.length === 0) {
    return {
      order_id: "",
      weighted_unit_cost: null,
      cogs: null,
      cost_known: false,
      currency_consistent: true,
      unit_count: 0,
    }
  }
  let cogs = 0
  let units = 0
  let anyMissing = false
  let consistent = true
  for (const c of consumptions) {
    units += c.quantity
    if (c.unit_cost == null || c.unit_cost === 0) {
      anyMissing = true
      continue
    }
    if ((c.currency || orderCurrency) !== orderCurrency) consistent = false
    cogs += c.unit_cost * c.quantity
  }
  if (expectedUnits != null && expectedUnits > 0 && units !== expectedUnits) {
    anyMissing = true
  }

  return {
    order_id: consumptions[0].order_id,
    weighted_unit_cost: anyMissing || units === 0 ? null : cogs / units,
    cogs: anyMissing ? null : cogs,
    cost_known: !anyMissing && units > 0,
    currency_consistent: consistent,
    unit_count: units,
  }
}

export type OrderProfit = {
  revenue: number
  cogs: number | null
  gross_profit: number | null
  margin: number | null
  unit_cost: number | null
  cost_known: boolean
  currency_consistent: boolean
  currency: string
}

export function computeOrderProfit(
  orderCurrency: string,
  orderTotal: number,
  consumptions: readonly CostConsumptionRow[] | undefined,
  expectedUnits?: number,
): OrderProfit {
  const s = summarizeOrderCost(orderCurrency, consumptions, expectedUnits)
  const revenue = Number.isFinite(orderTotal) ? orderTotal : 0
  if (!s.cost_known || s.cogs == null) {
    return {
      revenue,
      cogs: null,
      gross_profit: null,
      margin: null,
      unit_cost: null,
      cost_known: false,
      currency_consistent: s.currency_consistent,
      currency: orderCurrency,
    }
  }
  const profit = revenue - s.cogs
  return {
    revenue,
    cogs: s.cogs,
    gross_profit: profit,
    margin: revenue > 0 ? profit / revenue : null,
    unit_cost: s.weighted_unit_cost,
    cost_known: true,
    currency_consistent: s.currency_consistent,
    currency: orderCurrency,
  }
}

export type DashboardProfitTotals = {
  currency: string
  revenue: number
  cogs: number
  gross_profit: number
  margin: number | null
  /** Revenue from orders with a complete, non-zero buy price on every unit. */
  priced_revenue: number
  /** Revenue from orders excluded from COGS / profit (missing or zero buy price). */
  unpriced_revenue: number
  /** Orders with a complete cost basis included in COGS. */
  orders_priced: number
  /** Orders missing buy price, zero-cost snapshots, or incomplete consumption. */
  orders_missing_cost: number
  orders_total: number
}

export type DashboardProfitPeriod = {
  periodKey: string
  label: string
  totalsByCurrency: DashboardProfitTotals[]
  ordersMissingCost: number
  ordersTotal: number
}

export type DashboardProfit = {
  allTime: DashboardProfitPeriod
  monthly: DashboardProfitPeriod[]
}

type OrderForProfit = {
  id: string
  status: string
  total_amount: number | string
  currency: string
  guests: number
  created_at: string
}

function emptyBucket(currency: string): DashboardProfitTotals {
  return {
    currency,
    revenue: 0,
    cogs: 0,
    gross_profit: 0,
    margin: null,
    priced_revenue: 0,
    unpriced_revenue: 0,
    orders_priced: 0,
    orders_missing_cost: 0,
    orders_total: 0,
  }
}

function finalizeBuckets(buckets: Map<string, DashboardProfitTotals>): DashboardProfitTotals[] {
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      unpriced_revenue: Math.max(0, b.revenue - b.priced_revenue),
      margin: b.priced_revenue > 0 ? b.gross_profit / b.priced_revenue : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function aggregateProfitForOrders(
  orders: OrderForProfit[],
  byOrder: Map<string, CostConsumptionRow[]>,
): { totalsByCurrency: DashboardProfitTotals[]; ordersMissingCost: number } {
  const buckets = new Map<string, DashboardProfitTotals>()
  let ordersMissingCost = 0

  for (const o of orders) {
    const cur = (o.currency || "USD").trim() || "USD"
    const bucket = buckets.get(cur) ?? emptyBucket(cur)
    const total = n(o.total_amount)
    const guests = Math.max(0, Math.floor(n(o.guests)))

    bucket.revenue += total
    bucket.orders_total += 1

    const profit = computeOrderProfit(cur, total, byOrder.get(o.id), guests > 0 ? guests : undefined)
    if (profit.cost_known && profit.cogs != null) {
      bucket.cogs += profit.cogs
      bucket.gross_profit += profit.gross_profit ?? 0
      bucket.priced_revenue += total
      bucket.orders_priced += 1
    } else {
      bucket.orders_missing_cost += 1
      ordersMissingCost += 1
    }
    buckets.set(cur, bucket)
  }

  return { totalsByCurrency: finalizeBuckets(buckets), ordersMissingCost }
}

function monthKeyFromIso(createdAt: string): string | null {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, "0")}`
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  if (!y || !m) return monthKey
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export async function getDashboardProfit(): Promise<DashboardProfit> {
  noStore()
  const supabase = await createClient()
  const { data: orders, error: oe } = await supabase
    .from("orders")
    .select("id, status, total_amount, currency, guests, created_at")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(20000)
  if (oe || !orders) {
    const empty: DashboardProfitPeriod = {
      periodKey: "all",
      label: "All time",
      totalsByCurrency: [],
      ordersMissingCost: 0,
      ordersTotal: 0,
    }
    return { allTime: empty, monthly: [] }
  }

  const list = orders as OrderForProfit[]
  const orderIds = list.map((o) => o.id)
  const byOrder = await getConsumptionsForOrders(orderIds)

  const allAgg = aggregateProfitForOrders(list, byOrder)
  const allTime: DashboardProfitPeriod = {
    periodKey: "all",
    label: "All time",
    totalsByCurrency: allAgg.totalsByCurrency,
    ordersMissingCost: allAgg.ordersMissingCost,
    ordersTotal: list.length,
  }

  const byMonth = new Map<string, OrderForProfit[]>()
  for (const o of list) {
    const key = monthKeyFromIso(o.created_at)
    if (!key) continue
    const monthOrders = byMonth.get(key) ?? []
    monthOrders.push(o)
    byMonth.set(key, monthOrders)
  }

  const monthly: DashboardProfitPeriod[] = [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([periodKey, monthOrders]) => {
      const agg = aggregateProfitForOrders(monthOrders, byOrder)
      return {
        periodKey,
        label: monthLabel(periodKey),
        totalsByCurrency: agg.totalsByCurrency,
        ordersMissingCost: agg.ordersMissingCost,
        ordersTotal: monthOrders.length,
      }
    })

  return { allTime, monthly }
}
