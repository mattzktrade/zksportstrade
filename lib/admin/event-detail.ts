import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCostLayerQuantityTotalsByPackage } from "@/lib/admin/cost-layers"
import { adminPackagePath } from "@/lib/admin/package-link"
import { unsignedPipelinePlaces } from "@/lib/admin/package-sales-breakdown"
import { getPackageSalesBreakdownByPackage } from "@/lib/admin/package-sales-breakdown-queries"
import { isEventCategory, type EventCategory } from "@/lib/catalog/event-categories"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { adminDealPath, adminOrderDealPath } from "@/lib/admin/deal-link"
import { getDealsForPackages } from "@/lib/crm/deals"
import { DEAL_STAGE_LABELS, dealSourceLabel, type DealStage } from "@/lib/crm/deal-types"
import { invoiceDisplayLabel } from "@/lib/invoices/status"

export type NativeEventDetailEvent = {
  id: string
  category: EventCategory
  name: string
  shortName: string
  location: string
  country: string
  countryCode: string
  eventDate: string
  dateRange: string
  image: string
  season: number
  isArchived: boolean
}

export type NativeEventProductRow = {
  id: string
  name: string
  durationLabel: string
  price: number
  currency: string
  hidden: boolean
  bought: number
  sold: number
  pipeline: number
  available: number
  held: number
}

export type NativeEventSaleRow = {
  id: string
  kind: "order" | "deal"
  href: string
  reference: string
  date: string
  clientName: string
  accountId: string | null
  contactId: string | null
  contactName: string | null
  productName: string
  quantity: number
  amount: number
  currency: string
  status: string
  source: string
  confirmed: boolean
}

export type NativeEventDetail = {
  event: NativeEventDetailEvent
  products: NativeEventProductRow[]
  sales: NativeEventSaleRow[]
  totals: {
    productCount: number
    sold: number
    pipeline: number
    remaining: number
    revenue: number
    currency: string
  }
}

function orderChannelLabel(channel: string | null | undefined): string {
  switch (String(channel ?? "").toLowerCase()) {
    case "wix":
    case "website":
      return "Website"
    case "trade_portal":
      return "Portal"
    case "partner_api":
      return "Partner"
    case "native_deal":
    case "admin":
    case "offline":
      return "Offline"
    default:
      return channel ? dealSourceLabel(channel) : "Order"
  }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function getNativeEventDetail(eventId: string): Promise<NativeEventDetail | null> {
  noStore()
  const id = eventId.trim()
  if (!id) return null
  const supabase = await createClient()
  const { data: race, error: raceError } = await supabase
    .from("races")
    .select(
      "id, name, short_name, location, country, country_code, event_date, date_range, image, season, category, is_archived",
    )
    .eq("id", id)
    .maybeSingle()
  if (raceError || !race) return null

  const { data: packageRows } = await supabase
    .from("packages")
    .select(
      "id, name, duration, trade_price, currency, is_hidden, shell_parent_package_id, sort_order",
    )
    .eq("race_id", id)
    .order("sort_order")

  const productsSource = (packageRows ?? []).filter((pkg) => !pkg.shell_parent_package_id)
  const packageIds = productsSource.map((pkg) => String(pkg.id))

  const [inventoryResult, boughtByPkg, salesByPkg, deals] = await Promise.all([
    packageIds.length
      ? supabase.from("package_inventory").select("package_id, qty_available, qty_held").in("package_id", packageIds)
      : Promise.resolve({ data: [] as Array<{ package_id: string; qty_available: number; qty_held: number }> }),
    getCostLayerQuantityTotalsByPackage(packageIds),
    getPackageSalesBreakdownByPackage(packageIds),
    getDealsForPackages(packageIds),
  ])

  const inventoryBy = new Map(
    (inventoryResult.data ?? []).map((row) => [String(row.package_id), row]),
  )
  const products: NativeEventProductRow[] = productsSource.map((pkg) => {
    const pkgId = String(pkg.id)
    const breakdown = salesByPkg.get(pkgId)
    const inventory = inventoryBy.get(pkgId)
    return {
      id: pkgId,
      name: String(pkg.name),
      durationLabel: packageDurationLabel(pkg.duration) ?? "—",
      price: Number(pkg.trade_price ?? 0),
      currency: String(pkg.currency || "USD"),
      hidden: Boolean(pkg.is_hidden),
      bought: boughtByPkg.get(pkgId)?.quantity_purchased ?? 0,
      sold: breakdown?.total ?? 0,
      pipeline: breakdown ? unsignedPipelinePlaces(breakdown) : 0,
      available: Number(inventory?.qty_available ?? 0),
      held: Number(inventory?.qty_held ?? 0),
    }
  })

  const sales: NativeEventSaleRow[] = []
  const ordersCovered = new Set<string>()

  if (packageIds.length) {
    const { data: lineRows } = await supabase
      .from("order_line_items")
      .select(
        `
        quantity, unit_price, line_total, package_id,
        packages(name),
        orders!inner(
          id, reference, status, channel, client_name, created_at, currency,
          deal_id, crm_account_id, crm_contact_id, total_amount
        )
      `,
      )
      .in("package_id", packageIds)

    for (const row of lineRows ?? []) {
      const order = one(row.orders as Record<string, unknown> | Record<string, unknown>[] | null)
      if (!order || String(order.status) === "cancelled") continue
      const orderId = String(order.id)
      ordersCovered.add(orderId)
      const pkg = one(row.packages as { name: string } | { name: string }[] | null)
      const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0))
      const amount = Number(row.line_total ?? Number(row.unit_price ?? 0) * quantity)
      sales.push({
        id: `order:${orderId}:${String(row.package_id)}`,
        kind: "order",
        href: adminOrderDealPath(order.deal_id ? String(order.deal_id) : null) ?? adminPackagePath(String(row.package_id), "orders"),
        reference: String(order.reference ?? ""),
        date: String(order.created_at ?? ""),
        clientName: String(order.client_name || "—"),
        accountId: order.crm_account_id ? String(order.crm_account_id) : null,
        contactId: order.crm_contact_id ? String(order.crm_contact_id) : null,
        contactName: null,
        productName: pkg?.name ?? "Package",
        quantity,
        amount,
        currency: String(order.currency || "USD"),
        status: invoiceDisplayLabel(null),
        source: orderChannelLabel(String(order.channel ?? "")),
        confirmed: true,
      })
    }

    const { data: invoiceRows } = ordersCovered.size
      ? await supabase
          .from("invoices")
          .select("order_id, status")
          .in("order_id", [...ordersCovered])
      : { data: [] as Array<{ order_id: string; status: string }> }
    const invoiceByOrder = new Map(
      (invoiceRows ?? []).map((row) => [String(row.order_id), String(row.status)]),
    )
    for (const sale of sales) {
      if (sale.kind !== "order") continue
      const orderId = sale.id.split(":")[1]
      const invoiceStatus = invoiceByOrder.get(orderId)
      sale.status = invoiceStatus ? invoiceDisplayLabel(invoiceStatus) : "Confirmed"
    }

    const { data: headerOrders } = await supabase
      .from("orders")
      .select(
        "id, reference, status, channel, client_name, created_at, currency, deal_id, crm_account_id, crm_contact_id, guests, total_amount, package_id",
      )
      .in("package_id", packageIds)
      .neq("status", "cancelled")

    for (const order of headerOrders ?? []) {
      const orderId = String(order.id)
      if (ordersCovered.has(orderId)) continue
      const pkg = productsSource.find((row) => String(row.id) === String(order.package_id))
      sales.push({
        id: `order:${orderId}`,
        kind: "order",
        href: adminOrderDealPath(order.deal_id ? String(order.deal_id) : null) ?? adminPackagePath(String(order.package_id), "orders"),
        reference: String(order.reference ?? ""),
        date: String(order.created_at ?? ""),
        clientName: String(order.client_name || "—"),
        accountId: order.crm_account_id ? String(order.crm_account_id) : null,
        contactId: order.crm_contact_id ? String(order.crm_contact_id) : null,
        contactName: null,
        productName: pkg?.name ? String(pkg.name) : "Package",
        quantity: Math.max(0, Math.floor(Number(order.guests) || 0)),
        amount: Number(order.total_amount ?? 0),
        currency: String(order.currency || "USD"),
        status: "Confirmed",
        source: orderChannelLabel(String(order.channel ?? "")),
        confirmed: true,
      })
    }
  }

  const dealIdsWithOrders = new Set(
    deals.map((deal) => deal.orderId).filter((value): value is string => Boolean(value)),
  )
  for (const deal of deals) {
    if (deal.orderId && dealIdsWithOrders.has(deal.orderId)) continue
    sales.push({
      id: `deal:${deal.id}`,
      kind: "deal",
      href: adminDealPath(deal.id),
      reference: deal.reference,
      date: deal.createdAt,
      clientName: deal.accountName || deal.contactName || "—",
      accountId: deal.accountId,
      contactId: deal.contactId,
      contactName: deal.contactName,
      productName: deal.lineSummary || "Deal",
      quantity: deal.quantity,
      amount: deal.totalAmount,
      currency: deal.currency,
      status: DEAL_STAGE_LABELS[deal.stage as DealStage] ?? deal.stage,
      source: dealSourceLabel(deal.source),
      confirmed: ["awaiting_payment", "paid_confirmed", "in_fulfilment", "fulfilled"].includes(deal.stage),
    })
  }

  const accountIds = [...new Set(sales.map((sale) => sale.accountId).filter((value): value is string => Boolean(value)))]
  const contactIds = [...new Set(sales.map((sale) => sale.contactId).filter((value): value is string => Boolean(value)))]
  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    accountIds.length
      ? supabase.from("crm_accounts").select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    contactIds.length
      ? supabase.from("crm_contacts").select("id, full_name").in("id", contactIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
  ])
  const accountName = new Map((accounts ?? []).map((row) => [String(row.id), String(row.name)]))
  const contactName = new Map((contacts ?? []).map((row) => [String(row.id), String(row.full_name)]))
  for (const sale of sales) {
    if (sale.accountId && accountName.get(sale.accountId)) {
      if (!sale.contactName && sale.clientName && sale.clientName !== "—") {
        sale.contactName = contactName.get(sale.contactId ?? "") || sale.clientName
      }
      sale.clientName = accountName.get(sale.accountId) ?? sale.clientName
    } else if (sale.contactId && contactName.get(sale.contactId) && !sale.contactName) {
      sale.contactName = contactName.get(sale.contactId) ?? null
    }
  }

  sales.sort((a, b) => b.date.localeCompare(a.date))

  const sold = products.reduce((sum, product) => sum + product.sold, 0)
  const pipeline = products.reduce((sum, product) => sum + product.pipeline, 0)
  const remaining = products.reduce((sum, product) => sum + product.available, 0)
  const revenue = sales.filter((sale) => sale.confirmed).reduce((sum, sale) => sum + sale.amount, 0)
  const currency = products[0]?.currency || sales[0]?.currency || "USD"

  return {
    event: {
      id: String(race.id),
      category: isEventCategory(String(race.category)) ? (race.category as EventCategory) : "other",
      name: String(race.name),
      shortName: String(race.short_name),
      location: String(race.location),
      country: String(race.country),
      countryCode: String(race.country_code ?? ""),
      eventDate: String(race.event_date),
      dateRange: String(race.date_range),
      image: String(race.image || "/placeholder.svg"),
      season: Number(race.season),
      isArchived: Boolean(race.is_archived),
    },
    products,
    sales,
    totals: {
      productCount: products.length,
      sold,
      pipeline,
      remaining,
      revenue,
      currency,
    },
  }
}
