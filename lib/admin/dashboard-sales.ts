import { unstable_noStore as noStore } from "next/cache"
import { computeOrderProfit, getConsumptionsForOrders } from "@/lib/admin/cost-layers"
import type { DashboardSaleRow } from "@/lib/admin/admin-dashboard-metrics"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { chunkList, fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import { pickCurrentInvoice } from "@/lib/invoices/status"

export type DashboardSaleSource = DashboardSaleRow & {
  grossProfit?: number | null
  ownerId: string | null
}

/** Chart window plus a little history so a sale confirmed this month still has its order. */
export function dashboardSalesSince(now = new Date()): Date {
  const since = new Date(now)
  since.setUTCMonth(since.getUTCMonth() - 8)
  return since
}

const OPEN_INVOICE_STATUSES = ["awaiting_invoice", "awaiting_payment", "pending", "overdue"] as const
const UNLINKED_OPEN_STAGES = [
  "awaiting_booking_form_send",
  "booking_form_sent",
  "awaiting_client_signature",
  "awaiting_zk_signature",
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
] as const
const UNLINKED_WON_STAGES = ["paid_confirmed", "in_fulfilment", "fulfilled"] as const

const ORDER_COLUMNS =
  "id, reference, status, deal_id, agent_profile_id, crm_account_id, package_id, total_amount, currency, created_at, client_name"

type OrderLite = {
  id: string
  reference: string
  status: string
  deal_id: string | null
  agent_profile_id: string | null
  crm_account_id: string | null
  package_id: string
  total_amount: number | string | null
  currency: string | null
  created_at: string
  client_name: string | null
}

type InvoiceLite = {
  id: string
  order_id: string
  status: string
  overdue_since: string | null
  paid_at: string | null
  xero_amount_due: number | string | null
  created_at: string | null
}

type DealLite = {
  id: string
  reference: string
  stage: string
  account_id: string | null
  owner_profile_id: string | null
  order_id: string | null
  currency: string | null
  total_amount: number | string | null
  created_at: string
  closed_at: string | null
}

type WonLine = {
  quantity: number | string | null
  expected_unit_cost: number | string | null
  packages:
    | { name: string; races: { name: string; season: number | null } | Array<{ name: string; season: number | null }> | null }
    | Array<{ name: string; races: { name: string; season: number | null } | Array<{ name: string; season: number | null }> | null }>
    | null
}

type WonDeal = DealLite & { deal_line_items: WonLine[] | null }

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function invoiceStatusFromDeal(stage: string | null | undefined, orderStatus: string): string | null {
  if (orderStatus === "cancelled") return "cancelled"
  switch (stage) {
    case "paid_confirmed":
    case "in_fulfilment":
    case "fulfilled":
      return "paid"
    case "awaiting_payment":
      return "awaiting_payment"
    case "awaiting_invoice":
    case "signed":
      return "awaiting_invoice"
    case "cancelled":
    case "closed_lost":
      return "cancelled"
    default:
      return null
  }
}

async function loadInChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < chunkList(ids, 80).length; i += 4) {
    const chunks = chunkList(ids, 80).slice(i, i + 4)
    const results = await Promise.all(chunks.map((chunk) => run(chunk)))
    for (const result of results) {
      if (!result.error && result.data) rows.push(...result.data)
    }
  }
  return rows
}

function emptySale(overrides: Partial<DashboardSaleSource> & Pick<DashboardSaleSource, "id" | "reference" | "total" | "currency" | "createdAt">): DashboardSaleSource {
  return {
    dealId: null,
    dealReference: null,
    accountName: "Direct client",
    eventPackage: "Product not mapped",
    paidAt: null,
    ownerName: null,
    orderStatus: "confirmed",
    invoiceStatus: null,
    dealStage: null,
    fulfilmentStatus: "awaiting_payment",
    overdueSince: null,
    amountDue: 0,
    grossProfit: null,
    ownerId: null,
    ...overrides,
  }
}

export async function getDashboardSaleRows(sinceIso: string): Promise<DashboardSaleSource[]> {
  noStore()
  const supabase = await createClient()
  const dealColumns =
    "id, reference, stage, account_id, owner_profile_id, order_id, currency, total_amount, created_at, closed_at"

  const [recentOrders, openInvoices, paidInvoices, openDeals, wonByCreated, wonByClosed, cancelledOps] =
    await Promise.all([
      fetchAllRows<OrderLite>((from, to) =>
        supabase.from("orders").select(ORDER_COLUMNS).gte("created_at", sinceIso).order("id").range(from, to),
      ),
      fetchAllRows<InvoiceLite>((from, to) =>
        supabase
          .from("invoices")
          .select("id, order_id, status, overdue_since, paid_at, xero_amount_due, created_at")
          .in("status", [...OPEN_INVOICE_STATUSES])
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<InvoiceLite>((from, to) =>
        supabase
          .from("invoices")
          .select("id, order_id, status, overdue_since, paid_at, xero_amount_due, created_at")
          .gte("paid_at", sinceIso)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<DealLite>((from, to) =>
        supabase
          .from("deals")
          .select(dealColumns)
          .is("order_id", null)
          .in("stage", [...UNLINKED_OPEN_STAGES])
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<WonDeal>((from, to) =>
        supabase
          .from("deals")
          .select(`${dealColumns}, deal_line_items(quantity, expected_unit_cost, packages(name, races(name, season)))`)
          .is("order_id", null)
          .in("stage", [...UNLINKED_WON_STAGES])
          .gte("created_at", sinceIso)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<WonDeal>((from, to) =>
        supabase
          .from("deals")
          .select(`${dealColumns}, deal_line_items(quantity, expected_unit_cost, packages(name, races(name, season)))`)
          .is("order_id", null)
          .in("stage", [...UNLINKED_WON_STAGES])
          .gte("closed_at", sinceIso)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows<{ order_id: string }>((from, to) =>
        supabase
          .from("order_operations")
          .select("order_id")
          .eq("fulfilment_status", "cancelled")
          .order("order_id")
          .range(from, to),
      ),
    ])

  const orders = [...recentOrders.data]
  const seenOrders = new Set(orders.map((row) => String(row.id)))
  const invoiceRows = [...openInvoices.data, ...paidInvoices.data]
  const missingOrderIds = [
    ...new Set(
      invoiceRows
        .map((row) => String(row.order_id ?? ""))
        .filter((id) => id && !seenOrders.has(id)),
    ),
  ]
  if (missingOrderIds.length > 0) {
    const older = await loadInChunks<OrderLite>(missingOrderIds, (chunk) =>
      supabase.from("orders").select(ORDER_COLUMNS).in("id", chunk),
    )
    for (const row of older) {
      if (seenOrders.has(String(row.id))) continue
      seenOrders.add(String(row.id))
      orders.push(row)
    }
  }

  const dealIds = [...new Set(orders.map((row) => row.deal_id).filter((id): id is string => Boolean(id)))]
  const packageIds = [...new Set(orders.map((row) => String(row.package_id ?? "")).filter(Boolean))]
  const orderIds = orders.map((row) => String(row.id))

  const [linkedDeals, packages, consumptions] = await Promise.all([
    loadInChunks<DealLite>(dealIds, (chunk) => supabase.from("deals").select(dealColumns).in("id", chunk)),
    loadInChunks<{
      id: string
      name: string
      races: { name: string; season: number | null } | Array<{ name: string; season: number | null }> | null
    }>(packageIds, (chunk) => supabase.from("packages").select("id, name, races(name, season)").in("id", chunk)),
    getConsumptionsForOrders(orderIds),
  ])

  const accountIds = [
    ...new Set(
      [...orders.map((row) => row.crm_account_id), ...linkedDeals.map((row) => row.account_id), ...openDeals.data.map((row) => row.account_id), ...wonByCreated.data.map((row) => row.account_id), ...wonByClosed.data.map((row) => row.account_id)]
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const accounts = await loadInChunks<{ id: string; name: string }>(accountIds, (chunk) =>
    supabase.from("crm_accounts").select("id, name").in("id", chunk),
  )

  const dealById = new Map(linkedDeals.map((row) => [String(row.id), row]))
  const accountName = new Map(accounts.map((row) => [String(row.id), row.name]))
  const packageById = new Map(packages.map((row) => [String(row.id), row]))
  const invoicesByOrder = new Map<string, InvoiceLite[]>()
  for (const invoice of invoiceRows) {
    const orderId = String(invoice.order_id ?? "")
    if (!orderId) continue
    const list = invoicesByOrder.get(orderId) ?? []
    list.push(invoice)
    invoicesByOrder.set(orderId, list)
  }
  const cancelled = new Set(cancelledOps.data.map((row) => String(row.order_id)))

  const fromOrders = orders.map((row) => {
    const orderId = String(row.id)
    const deal = row.deal_id ? dealById.get(String(row.deal_id)) ?? null : null
    const invoice = pickCurrentInvoice(invoicesByOrder.get(orderId) ?? [])
    const invoiceStatus =
      invoice?.status ?? invoiceStatusFromDeal(deal?.stage, String(row.status)) ?? "awaiting_invoice"
    const paidLike = ["paid", "delivered", "cancelled"].includes(invoiceStatus)
    const total = Number(row.total_amount ?? 0)
    const currency = String(row.currency || "USD")
    const pkg = packageById.get(String(row.package_id))
    const race = one(pkg?.races)
    const profit = computeOrderProfit(currency, total, consumptions.get(orderId) ?? [])
    const accountId = row.crm_account_id ?? deal?.account_id ?? null
    return emptySale({
      id: orderId,
      reference: String(row.reference),
      dealId: deal?.id ?? row.deal_id ?? null,
      dealReference: deal?.reference ?? null,
      accountName: (accountId ? accountName.get(String(accountId)) : null) || row.client_name || "Direct client",
      eventPackage: pkg ? [race ? eventSeasonLabel(race.name, race.season) : null, pkg.name].filter(Boolean).join(" · ") : "Product not mapped",
      total,
      currency,
      createdAt: String(row.created_at),
      paidAt: invoice?.paid_at ?? null,
      orderStatus: String(row.status),
      invoiceStatus,
      dealStage: deal?.stage ?? null,
      fulfilmentStatus: cancelled.has(orderId) ? "cancelled" : paidLike ? "confirmed" : "awaiting_payment",
      overdueSince: invoice?.overdue_since ?? null,
      amountDue: invoice?.xero_amount_due == null ? (paidLike ? 0 : total) : Number(invoice.xero_amount_due),
      grossProfit: profit.gross_profit,
      ownerId: deal?.owner_profile_id ?? row.agent_profile_id ?? null,
    })
  })

  const wonById = new Map<string, WonDeal>()
  for (const deal of [...wonByCreated.data, ...wonByClosed.data]) wonById.set(String(deal.id), deal)
  const unlinked = [...openDeals.data, ...wonById.values()]
  const fromDeals = unlinked.map((deal) => {
    const lines = Array.isArray((deal as WonDeal).deal_line_items)
      ? ((deal as WonDeal).deal_line_items as WonLine[])
      : []
    const total = Number(deal.total_amount ?? 0)
    const currency = deal.currency || "USD"
    const invoiceStatus = invoiceStatusFromDeal(deal.stage, "confirmed") ?? "awaiting_invoice"
    const paidLike = ["paid", "delivered", "cancelled"].includes(invoiceStatus)
    const costKnown = lines.length > 0 && lines.every((line) => line.expected_unit_cost != null)
    const cogs = costKnown
      ? lines.reduce((sum, line) => sum + Number(line.expected_unit_cost) * Number(line.quantity), 0)
      : null
    const firstPackage = one(lines[0]?.packages)
    const race = one(firstPackage?.races)
    const eventPackage =
      lines
        .map((line) => {
          const pkg = one(line.packages)
          const lineRace = one(pkg?.races)
          if (!pkg) return null
          return [lineRace ? eventSeasonLabel(lineRace.name, lineRace.season) : null, pkg.name].filter(Boolean).join(" · ")
        })
        .filter(Boolean)
        .join(", ") || "Product not mapped"
    return emptySale({
      id: `deal:${deal.id}`,
      reference: deal.reference,
      dealId: deal.id,
      dealReference: deal.reference,
      accountName: (deal.account_id ? accountName.get(String(deal.account_id)) : null) || "Unknown account",
      eventPackage,
      total,
      currency,
      createdAt: deal.created_at.includes("T") ? deal.created_at : `${deal.created_at.slice(0, 10)}T12:00:00.000Z`,
      paidAt: paidLike ? deal.closed_at ?? deal.created_at : null,
      orderStatus: "confirmed",
      invoiceStatus,
      dealStage: deal.stage,
      fulfilmentStatus: deal.stage === "fulfilled" ? "delivered" : paidLike ? "confirmed" : "awaiting_payment",
      amountDue: paidLike ? 0 : total,
      grossProfit: cogs == null ? null : total - cogs,
      ownerId: deal.owner_profile_id,
    })
  })

  return [...fromOrders, ...fromDeals]
}
