import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { isOutstandingInvoiceStatus } from "@/lib/invoices/status"
import type { PortalProfile } from "@/lib/types/profile"
import { CATALOG_LIST_PACKAGE_COLUMNS, INVENTORY_COLUMNS, PACKAGE_COLUMNS } from "@/lib/catalog/columns"
import type { DbInventory, DbPackage } from "@/lib/catalog/map-rows"
import {
  getCostLayerQuantityTotalsByPackage,
  getCostLayersByPackage,
  summarizePackageCost,
  type CostLayerRow,
  type PackageCostSummary,
} from "@/lib/admin/cost-layers"
import {
  getPackageSalesBreakdownByPackage,
} from "@/lib/admin/package-sales-breakdown-queries"
import {
  loadFulfilmentSoldByCostLayer,
} from "@/lib/inventory/fulfilment-layer-sold"
import { recordFromSoldMap } from "@/lib/inventory/sold-by-cost-layer"
import { getNativePackageAvailability } from "@/lib/inventory/ledger"
import {
  emptyPackageSalesBreakdown,
  linkedPoolSellableForPackage,
  type PackageSalesBreakdown,
  type LinkedSellableMember,
} from "@/lib/admin/package-sales-breakdown"
import type { LinkedInventoryPackage, LinkedInventoryShellPackage } from "@/lib/admin/linked-inventory"
import { getSalesforceConfig, isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import {
  readSfInventorySnapshotsBulk,
  type SfInventorySnapshot,
} from "@/lib/integrations/salesforce/inventory-snapshot"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { isEventCategory, type EventCategory } from "@/lib/catalog/event-categories"
import { retailPriceFromTrade } from "@/lib/integrations/retail-price"
import { getSalesforceConnectionStatus, getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"

const AGENT_PROFILE_COLUMNS =
  "id, email, full_name, company_name, company_type, mobile, role, approval_status, created_at" as const
const PENDING_PROFILE_COLUMNS =
  "id, email, full_name, company_name, company_type, approval_status, created_at, approval_note" as const

export type AdminPackageRow = DbPackage & {
  inventory: DbInventory | null
  race_name: string
  cost_layers: CostLayerRow[]
  cost_summary: PackageCostSummary | null
  /** Sum of layer quantities — populated on list loads that skip full cost_layers. */
  layer_units_purchased?: number
  sales_breakdown: PackageSalesBreakdown
  salesforce_inventory: SfInventorySnapshot | null
  effective_website_price?: number | null
  fulfilment_sold_by_layer?: Record<string, number>
  canonical_availability?: {
    bought: number
    available: number
    net?: number
    reserved: number
    committed: number
    shortage: number
    historicalShortage: number
    brokeredShortage: number
  }
  /** Unified admin display balance, including linked-day sibling demand. */
  effective_sellable?: number
  effective_net?: number
}

function attachCanonicalAvailability(
  row: AdminPackageRow,
  availability: Awaited<ReturnType<typeof getNativePackageAvailability>>[number] | undefined,
): AdminPackageRow {
  if (!availability) return row
  return {
    ...row,
    canonical_availability: {
      bought: availability.layer_original_quantity ?? row.layer_units_purchased ?? 0,
      available: availability.legacy_sellable,
      net: availability.net_quantity ?? availability.legacy_sellable,
      reserved: availability.active_reservations,
      committed: availability.committed_quantity ?? row.sales_breakdown.total,
      shortage: availability.open_shortage_qty,
      historicalShortage: availability.historical_shortage_quantity ?? 0,
      brokeredShortage: availability.brokered_shortage_quantity ?? 0,
    },
  }
}

export type LinkedInventorySibling = LinkedInventoryPackage

export async function getLinkedInventoryPackages(
  inventoryGroupId: string,
): Promise<LinkedInventorySibling[]> {
  const supabase = await createClient()
  const groupId = inventoryGroupId.trim()
  if (!groupId) return []

  const { data: packages } = await supabase
    .from("packages")
    .select("id, name, duration, salesforce_product_id, shell_parent_package_id")
    .eq("inventory_group_id", groupId)
    .order("name")

  const rows = (packages ?? []).filter((p) => !p.shell_parent_package_id)
  if (rows.length === 0) return []

  const ids = rows.map((p) => p.id)
  const salesByPkg = await getPackageSalesBreakdownByPackage(ids)
  const layersByPkg = await getCostLayersByPackage(ids)
  const fulfilmentSold = recordFromSoldMap(await loadFulfilmentSoldByCostLayer(supabase, ids))

  const [invBy] = await Promise.all([
    (async () => {
      const { data: inv } = await supabase
        .from("package_inventory")
        .select("package_id, qty_available, qty_held")
        .in("package_id", ids)
      return new Map((inv ?? []).map((i) => [i.package_id, i]))
    })(),
  ])

  return rows.map((p) => {
    const row = invBy.get(p.id)
    const typed = p as { salesforce_product_id: string | null }
    return {
      id: p.id,
      name: p.name,
      duration: p.duration,
      qty_available: row?.qty_available ?? null,
      qty_held: row?.qty_held ?? null,
      salesforce_product_id: typed.salesforce_product_id ?? null,
      sales_breakdown: salesByPkg.get(p.id) ?? emptyPackageSalesBreakdown(p.id),
      cost_layers: layersByPkg.get(p.id) ?? [],
      fulfilment_sold_by_layer: fulfilmentSold,
    }
  })
}

/** @deprecated Use getLinkedInventoryPackages — kept for callers that exclude self. */
export async function getLinkedInventorySiblings(
  inventoryGroupId: string,
  excludePackageId?: string,
): Promise<LinkedInventorySibling[]> {
  const all = await getLinkedInventoryPackages(inventoryGroupId)
  if (!excludePackageId) return all
  return all.filter((p) => p.id !== excludePackageId)
}

/** Single Ticket shells for a 3-day parent — for the linked inventory Places sold table. */
export async function getLinkedShellInventoryPackages(
  threeDayParentId: string,
): Promise<LinkedInventoryShellPackage[]> {
  const supabase = await createClient()
  const parentId = threeDayParentId.trim()
  if (!parentId) return []

  const { data: shells } = await supabase
    .from("packages")
    .select("id, name, duration, salesforce_product_id")
    .eq("shell_parent_package_id", parentId)
    .order("duration")

  const rows = shells ?? []
  if (rows.length === 0) return []

  const ids = rows.map((p) => p.id)
  const salesByPkg = await getPackageSalesBreakdownByPackage(ids)

  return rows.map((p) => {
    const typed = p as { salesforce_product_id: string | null }
    return {
      id: p.id,
      name: p.name,
      duration: p.duration,
      salesforce_product_id: typed.salesforce_product_id ?? null,
      sales_breakdown: salesByPkg.get(p.id) ?? emptyPackageSalesBreakdown(p.id),
    }
  })
}

export type AdminRaceOption = {
  id: string
  name: string
  short_name: string
  date_range: string
  event_date: string
  location: string
  country: string
  country_code: string
  season: number
  category: EventCategory
}

export async function getAdminRaceOptions(): Promise<AdminRaceOption[]> {
  return getAdminRaceOptionsCached()
}

const getAdminRaceOptionsCached = cache(async (): Promise<AdminRaceOption[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("races")
    .select("id,name,short_name,date_range,event_date,location,country,country_code,season,category")
    .eq("is_archived", false)
    .order("season")
    .order("event_date")
  if (error || !data) return []
  return data.map((row) => ({
    ...row,
    category: isEventCategory(String(row.category)) ? row.category : "formula_1",
  })) as AdminRaceOption[]
})

export async function getPendingProfiles(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select(PENDING_PROFILE_COLUMNS)
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

export async function getApprovedAgents(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select(AGENT_PROFILE_COLUMNS)
    .eq("role", "agent")
    .eq("approval_status", "approved")
    .order("company_name", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export type AdminAgentOrderRow = {
  orderId: string
  reference: string
  createdAt: string
  totalAmount: number
  currency: string
  packageId: string
  packageName: string
  circuit: string
  invoiceReference: string | null
  invoiceId: string | null
  invoiceStatus: string | null
}

export type AdminAgentWithStats = PortalProfile & {
  orderCount: number
  outstandingInvoiceCount: number
  /** Non-cancelled order totals by ISO currency code. */
  revenueByCurrency: Record<string, number>
  /** Short display for the table (e.g. one currency or multiple currencies joined). */
  revenueSummary: string
  /** Most recent orders for the expandable panel (capped per agent). */
  recentOrders: AdminAgentOrderRow[]
  /** All order references for admin search (not limited to recent cap). */
  orderSearchBlob: string
}

function formatRevenueSummary(by: Record<string, number>): string {
  const entries = Object.entries(by).filter(([, v]) => v > 0)
  if (entries.length === 0) return "—"
  const fmt = (currency: string, amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }
  if (entries.length === 1) {
    const [c, a] = entries[0]
    return fmt(c, a)
  }
  return entries.map(([c, a]) => fmt(c, a)).join(" · ")
}

type RawOrderForAgent = {
  id: string
  reference: string
  agent_profile_id: string
  package_id: string
  status: string
  guests: number
  total_amount: number
  currency: string
  created_at: string
  packages?: { name: string; circuit: string } | { name: string; circuit: string }[] | null
  invoices?:
    | { id: string; reference: string; status: string }
    | { id: string; reference: string; status: string }[]
    | null
}

/** Approved agents with live order / invoice aggregates for the admin Agents screen. */
export async function getAdminAgentsWithOrderStats(): Promise<AdminAgentWithStats[]> {
  const agents = await getApprovedAgents()
  if (agents.length === 0) return []

  const supabase = await createClient()
  const ids = agents.map((a) => a.id)
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      reference,
      agent_profile_id,
      package_id,
      status,
      total_amount,
      currency,
      created_at,
      packages ( name, circuit ),
      invoices ( id, reference, status )
    `,
    )
    .in("agent_profile_id", ids)
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error || !data) {
    return agents.map((a) => ({
      ...a,
      orderCount: 0,
      outstandingInvoiceCount: 0,
      revenueByCurrency: {},
      revenueSummary: "—",
      recentOrders: [],
      orderSearchBlob: "",
    }))
  }

  const rows = data as RawOrderForAgent[]
  const byAgent = new Map<string, RawOrderForAgent[]>()
  for (const r of rows) {
    const list = byAgent.get(r.agent_profile_id) ?? []
    list.push(r)
    byAgent.set(r.agent_profile_id, list)
  }

  const RECENT_CAP = 40

  return agents.map((agent) => {
    const list = byAgent.get(agent.id) ?? []
    let outstandingInvoiceCount = 0
    const revenueByCurrency: Record<string, number> = {}

    for (const r of list) {
      const inv = one(r.invoices)
      if (inv && isOutstandingInvoiceStatus(inv.status)) {
        outstandingInvoiceCount += 1
      }
      if (r.status !== "cancelled") {
        const cur = (r.currency ?? "USD").trim() || "USD"
        revenueByCurrency[cur] = (revenueByCurrency[cur] ?? 0) + Number(r.total_amount)
      }
    }

    const recentOrders: AdminAgentOrderRow[] = list.slice(0, RECENT_CAP).map((r) => {
      const pkg = one(r.packages)
      const inv = one(r.invoices)
      return {
        orderId: r.id,
        reference: r.reference,
        createdAt: r.created_at,
        totalAmount: Number(r.total_amount),
        currency: (r.currency ?? "USD").trim() || "USD",
        packageId: r.package_id,
        packageName: pkg?.name ?? "—",
        circuit: pkg?.circuit ?? "—",
        invoiceReference: inv?.reference ?? null,
        invoiceId: inv?.id ?? null,
        invoiceStatus: inv?.status ?? null,
      }
    })

    const orderSearchBlob = list
      .map((r) => {
        const pkg = one(r.packages)
        return [r.reference, pkg?.name ?? ""].filter(Boolean).join(" ")
      })
      .join(" ")

    return {
      ...agent,
      orderCount: list.length,
      outstandingInvoiceCount,
      revenueByCurrency,
      revenueSummary: formatRevenueSummary(revenueByCurrency),
      recentOrders,
      orderSearchBlob,
    }
  })
}

export async function getAdminPackageById(packageId: string): Promise<AdminPackageRow | null> {
  const supabase = await createClient()
  const id = packageId.trim()
  if (!id) return null

  const [{ data: pkg, error: pe }, { data: inv }] = await Promise.all([
    supabase.from("packages").select(PACKAGE_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("package_inventory").select(INVENTORY_COLUMNS).eq("package_id", id).maybeSingle(),
  ])
  if (pe || !pkg) return null

  const row = pkg as DbPackage

  const [
    { data: race },
    layersByPkg,
    salesByPkg,
    sfInventoryByProduct,
    fulfilmentSold,
    { data: canonical },
  ] = await Promise.all([
    supabase.from("races").select("id,name,season").eq("id", row.race_id).maybeSingle(),
    getCostLayersByPackage([id]),
    getPackageSalesBreakdownByPackage([id]),
    getSalesforceInventorySnapshotsForPackages([row]),
    loadFulfilmentSoldByCostLayer(supabase, [id]),
    supabase
      .from("inventory_availability")
      .select("*")
      .eq("package_id", id)
      .maybeSingle(),
  ])
  const layers = layersByPkg.get(id) ?? []
  const summary = summarizePackageCost(row.currency || "USD", layers)
  if (summary) summary.package_id = id
  const typedRace = race as { id: string; name: string; season: number } | null
  const raceName = typedRace
    ? eventSeasonLabel(typedRace.name, typedRace.season)
    : row.race_id
  return {
    ...row,
    inventory: (inv as DbInventory | null) ?? null,
    race_name: raceName,
    cost_layers: layers,
    cost_summary: summary,
    sales_breakdown: salesByPkg.get(id) ?? emptyPackageSalesBreakdown(id),
    fulfilment_sold_by_layer: recordFromSoldMap(fulfilmentSold),
    canonical_availability: canonical
      ? {
          bought: Number(canonical.layer_original_quantity ?? 0),
          available: Number(canonical.available_quantity ?? 0),
          net: Number(canonical.net_quantity ?? canonical.available_quantity ?? 0),
          reserved: Number(canonical.reserved_quantity ?? 0),
          committed: Number(canonical.committed_quantity ?? 0),
          shortage:
            Number(canonical.historical_shortage_quantity ?? 0) +
            Number(canonical.brokered_shortage_quantity ?? 0),
          historicalShortage: Number(canonical.historical_shortage_quantity ?? 0),
          brokeredShortage: Number(canonical.brokered_shortage_quantity ?? 0),
        }
      : undefined,
    salesforce_inventory:
      row.salesforce_product_id?.trim()
        ? sfInventoryByProduct.get(row.salesforce_product_id.trim()) ?? null
        : null,
  }
}

/**
 * Fast catalog list — slim package columns plus bought/sold movement totals.
 * Full cost-layer rows and Wix listings still load on the product page.
 */
export async function getAdminCatalogListRows(options?: {
  includeSalesforceInventory?: boolean
}): Promise<AdminPackageRow[]> {
  const supabase = await createClient()
  const [
    { data: races, error: re },
    { data: packages, error: pe },
    { data: inv, error: ie },
  ] =
    await Promise.all([
      supabase.from("races").select("id,name,season").order("event_date"),
      supabase.from("packages").select(CATALOG_LIST_PACKAGE_COLUMNS).order("sort_order"),
      supabase.from("package_inventory").select(INVENTORY_COLUMNS),
    ])
  if (re || pe || ie || !packages) return []
  const raceName = new Map(
    (races ?? []).map((r: { id: string; name: string; season: number }) => [
      r.id,
      eventSeasonLabel(r.name, r.season),
    ]),
  )
  const invBy = new Map((inv ?? []).map((i: DbInventory) => [i.package_id, i]))
  const packageIds = (packages as DbPackage[]).map((p) => p.id)
  const [layerTotalsByPkg, salesByPkg, sfInventoryByProduct] = await Promise.all([
    getCostLayerQuantityTotalsByPackage(packageIds),
    getPackageSalesBreakdownByPackage(packageIds),
    options?.includeSalesforceInventory
      ? getSalesforceInventorySnapshotsForPackages(packages as DbPackage[])
      : Promise.resolve(new Map<string, SfInventorySnapshot>()),
  ])
  const rows = (packages as DbPackage[]).map((p) => {
    const inventory = invBy.get(p.id) ?? null
    const layerTotals = layerTotalsByPkg.get(p.id)
    const sales = salesByPkg.get(p.id) ?? emptyPackageSalesBreakdown(p.id)
    const bought = layerTotals?.quantity_purchased ?? 0
    const packageRow = {
      ...p,
    total_capacity: 0,
    requires_booking_approval: false,
    image: p.image ?? null,
    tier: "",
    includes: Array.isArray(p.includes)
      ? p.includes.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    featured: Boolean(p.featured),
    brochure_url: typeof p.brochure_url === "string" ? p.brochure_url : null,
    description: typeof p.description === "string" ? p.description : null,
    gallery_images: Array.isArray(p.gallery_images)
      ? p.gallery_images.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    salesforce_product_family: null,
    retail_price_multiplier: p.retail_price_multiplier ?? null,
    wix_retail_price: p.wix_retail_price ?? null,
    effective_website_price: retailPriceFromTrade(
      p.trade_price,
      p.retail_price_multiplier,
      p.wix_retail_price,
    ),
    sell_on_trade_portal: p.sell_on_trade_portal !== false,
    sell_on_wix: Boolean(p.sell_on_wix),
    sell_on_partners: false,
    integration_sync_status: "idle",
    integration_synced_at: null,
    integration_sync_error: null,
    inventory,
    race_name: raceName.get(p.race_id) ?? p.race_id,
    cost_layers: [],
    cost_summary: null,
    layer_units_purchased: bought,
    sales_breakdown: sales,
    salesforce_inventory:
      p.salesforce_product_id?.trim()
        ? (sfInventoryByProduct.get(p.salesforce_product_id.trim()) ?? null)
        : null,
    }
    return packageRow as AdminPackageRow
  })
  const linkedGroups = new Map<string, AdminPackageRow[]>()
  for (const row of rows) {
    const groupId = row.inventory_group_id?.trim()
    if (!groupId || row.shell_parent_package_id) continue
    const members = linkedGroups.get(groupId) ?? []
    members.push(row)
    linkedGroups.set(groupId, members)
  }
  for (const row of rows) {
    const groupId = row.inventory_group_id?.trim()
    const groupMembers = groupId ? linkedGroups.get(groupId) ?? [] : []
    const stockSource = groupMembers.length > 1 ? groupMembers : [row]
    const purchasedStock = Math.max(
      ...stockSource.map((member) => Number(member.layer_units_purchased ?? 0)),
      0,
    )
    const stock =
      purchasedStock > 0
        ? purchasedStock
        : Math.max(0, Number(row.inventory?.qty_available ?? 0))
    if (groupMembers.length > 1) {
      const members: LinkedSellableMember[] = groupMembers.map((member) => ({
        id: member.id,
        duration: member.duration ?? null,
        breakdown: member.sales_breakdown,
      }))
      row.effective_sellable = Math.max(
        0,
        linkedPoolSellableForPackage({
          stock,
          targetId: row.id,
          targetDuration: row.duration ?? null,
          members,
        }),
      )
      row.effective_net = linkedPoolSellableForPackage({
        stock,
        targetId: row.id,
        targetDuration: row.duration ?? null,
        members: members.map((member) => ({
          ...member,
          breakdown: {
            ...member.breakdown,
            salesforceOpenPipeline: 0,
          },
        })),
      })
    } else {
      row.effective_sellable = Math.max(
        0,
        Math.floor(
          stock -
            Number(row.sales_breakdown.total ?? 0) -
            Number(row.sales_breakdown.salesforceOpenPipeline ?? 0),
        ),
      )
      row.effective_net = Math.floor(stock - Number(row.sales_breakdown.total ?? 0))
    }
  }
  return rows
}

/**
 * Options for {@link getAdminPackageRows}. Salesforce inventory and full cost layers are
 * skipped by default so the catalog page loads fast — CSV export opts in via a follow-up fetch.
 */
export type GetAdminPackageRowsOptions = {
  /** When true, bulk-read Salesforce Product2 for every package. */
  includeSalesforceInventory?: boolean
  /** When true, load full cost layer rows (heavier). Default false for catalog list. */
  includeCostLayers?: boolean
}

export async function getAdminPackageRows(
  options?: GetAdminPackageRowsOptions,
): Promise<AdminPackageRow[]> {
  const supabase = await createClient()
  const [{ data: races, error: re }, { data: packages, error: pe }, { data: inv, error: ie }] = await Promise.all([
    supabase.from("races").select("id,name,season").order("event_date"),
    supabase.from("packages").select(PACKAGE_COLUMNS).order("sort_order"),
    supabase.from("package_inventory").select(INVENTORY_COLUMNS),
  ])
  if (re || pe || ie || !packages) return []
  const raceName = new Map(
    (races ?? []).map((r: { id: string; name: string; season: number }) => [
      r.id,
      eventSeasonLabel(r.name, r.season),
    ]),
  )
  const invBy = new Map((inv ?? []).map((i: DbInventory) => [i.package_id, i]))
  const packageIds = (packages as DbPackage[]).map((p) => p.id)
  const includeCostLayers = options?.includeCostLayers === true
  const [layersByPkg, layerTotalsByPkg, salesByPkg, sfInventoryByProduct, availabilityRows] = await Promise.all([
    includeCostLayers ? getCostLayersByPackage(packageIds) : Promise.resolve(new Map<string, CostLayerRow[]>()),
    includeCostLayers ? Promise.resolve(new Map<string, { quantity_purchased: number; quantity_remaining: number }>()) : getCostLayerQuantityTotalsByPackage(packageIds),
    getPackageSalesBreakdownByPackage(packageIds),
    options?.includeSalesforceInventory
      ? getSalesforceInventorySnapshotsForPackages(packages as DbPackage[])
      : Promise.resolve(new Map<string, SfInventorySnapshot>()),
    getNativePackageAvailability(packageIds),
  ])
  const availabilityByPackage = new Map(
    availabilityRows.map((availability) => [availability.package_id, availability]),
  )
  return (packages as DbPackage[]).map((p) => {
    const layers = layersByPkg.get(p.id) ?? []
    const totals = layerTotalsByPkg.get(p.id)
    const summary = includeCostLayers ? summarizePackageCost(p.currency || "USD", layers) : null
    if (summary) summary.package_id = p.id
    const packageRow: AdminPackageRow = {
      ...p,
      inventory: invBy.get(p.id) ?? null,
      race_name: raceName.get(p.race_id) ?? p.race_id,
      cost_layers: layers,
      cost_summary: summary,
      layer_units_purchased: totals?.quantity_purchased,
      sales_breakdown: salesByPkg.get(p.id) ?? emptyPackageSalesBreakdown(p.id),
      effective_website_price: retailPriceFromTrade(
        p.trade_price,
        p.retail_price_multiplier,
        p.wix_retail_price,
      ),
      salesforce_inventory:
        p.salesforce_product_id?.trim() ? (sfInventoryByProduct.get(p.salesforce_product_id.trim()) ?? null) : null,
    }
    return attachCanonicalAvailability(packageRow, availabilityByPackage.get(p.id))
  })
}

async function getSalesforceInventorySnapshotsForPackages(
  packages: DbPackage[],
): Promise<Map<string, SfInventorySnapshot>> {
  if (!isSalesforceConfigured()) return new Map()
  const connection = await getSalesforceConnectionStatus()
  if (!connection.connected) return new Map()

  const instanceUrl = (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
  const config = getSalesforceConfig(instanceUrl || undefined)
  if (!config) return new Map()

  const productIds = packages
    .map((pkg) => pkg.salesforce_product_id?.trim() ?? "")
    .filter(Boolean)
  if (productIds.length === 0) return new Map()

  try {
    return await readSfInventorySnapshotsBulk(productIds, config)
  } catch (e) {
    console.warn("[admin] Salesforce inventory snapshot unavailable:", e instanceof Error ? e.message : e)
    return new Map()
  }
}

export type InventoryHoldRow = {
  id: string
  package_id: string
  agent_profile_id: string
  quantity: number
  note: string | null
  created_at: string
  released_at: string | null
  expires_at: string
}

/** Packages that have an inventory row (required for holds). */
export type InventoryPackageOption = {
  id: string
  name: string
  race_name: string
  circuit: string
  date_range: string
  location: string
  qty_available: number
  qty_held: number
}

export type InventoryHoldWithDetails = InventoryHoldRow & {
  package_name: string
  /** Race / dates / circuit so holds line up with the right event. */
  package_event_summary: string
  agent_email: string
  agent_company: string
}

function packageEventSummary(
  raceName: string,
  p: { date_range: string; circuit: string; location: string },
): string {
  const bits = [raceName]
  const dr = p.date_range?.trim()
  const circ = p.circuit?.trim()
  const loc = p.location?.trim()
  if (dr) bits.push(dr)
  if (circ) bits.push(circ)
  else if (loc) bits.push(loc)
  return bits.join(" · ")
}

export async function getInventoryHoldsWithDetails(): Promise<InventoryHoldWithDetails[]> {
  const supabase = await createClient()
  const { data: holds, error } = await supabase
    .from("inventory_holds")
    .select("id, package_id, agent_profile_id, quantity, note, created_at, released_at, expires_at")
    .order("created_at", { ascending: false })
  if (error || !holds?.length) return []

  const packageIds = [...new Set(holds.map((h) => h.package_id))]
  const agentIds = [...new Set(holds.map((h) => h.agent_profile_id))]

  const [{ data: pkgs }, { data: profs }] = await Promise.all([
    supabase.from("packages").select("id,name,circuit,date_range,race_id,location").in("id", packageIds),
    supabase.from("profiles").select("id,email,company_name").in("id", agentIds),
  ])

  const raceIds = [...new Set((pkgs ?? []).map((p: { race_id: string }) => p.race_id))]
  const { data: races } = await supabase.from("races").select("id,name").in("id", raceIds)
  const raceName = new Map((races ?? []).map((r: { id: string; name: string }) => [r.id, r.name]))

  const pkgById = new Map(
    (pkgs ?? []).map((p: { id: string; name: string; circuit: string; date_range: string; race_id: string; location: string }) => [
      p.id,
      p,
    ]),
  )
  const profBy = new Map(
    (profs ?? []).map((p: { id: string; email: string; company_name: string }) => [
      p.id,
      { email: p.email, company_name: p.company_name },
    ]),
  )

  return holds.map((h) => {
    const agent = profBy.get(h.agent_profile_id)
    const pkg = pkgById.get(h.package_id)
    const rn = pkg ? raceName.get(pkg.race_id) ?? pkg.race_id : ""
    return {
      ...(h as InventoryHoldRow),
      package_name: pkg?.name ?? h.package_id,
      package_event_summary: pkg ? packageEventSummary(rn, pkg) : "",
      agent_email: agent?.email ?? "",
      agent_company: agent?.company_name ?? "",
    }
  })
}
