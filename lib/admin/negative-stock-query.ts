import { cache } from "react"
import { unstable_noStore as noStore } from "next/cache"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { dealStageCountsAsSold, DEAL_SOLD_STAGES } from "@/lib/crm/deal-types"
import { isSupplierQuoteFresh } from "@/lib/inventory/native-availability"
import { uncoveredQuantitiesFromLinkedDayPlan } from "@/lib/inventory/linked-day-coverage"
import { fetchAllRows, mapChunks } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import {
  mergeNegativeStockRows,
  NEGATIVE_STOCK_OPEN_STATUSES,
  uncoveredSoldQuantity,
  type NegativeStockRow,
  type NegativeStockStatus,
} from "@/lib/admin/negative-stock"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type ShortagePackageJoin = {
  id: string
  name: string
  trade_price: number | null
  location: string | null
  currency?: string | null
  races:
    | { name: string; season: number | null; event_date: string | null }
    | Array<{ name: string; season: number | null; event_date: string | null }>
    | null
}

type DealLineJoin = {
  id: string
  package_id: string
  quantity?: number | null
  unit_sale_price: number | null
  expected_unit_cost: number | null
  sourcing_mode: "owned" | "brokered" | null
  supplier_id?: string | null
  supplier_quote_at?: string | null
}

type DealMapValue = {
  reference: string | null
  stage: string
  ownerProfileId: string | null
  ownerName: string | null
  accountId: string | null
  accountName: string | null
  lines: DealLineJoin[]
}

type ExtraDealRow = {
  id: string
  reference: string | null
  stage: string
  owner_profile_id: string | null
  account_id: string | null
  crm_accounts: { name: string } | { name: string }[] | null
  deal_line_items: DealLineJoin[] | null
}

function purchaseReadyDeal(deal: DealMapValue | null, dealId: string | null): boolean {
  if (!dealId) return true
  if (!deal) return false
  return dealStageCountsAsSold(deal.stage)
}

const ID_CHUNK = 80
type AdminDb = Awaited<ReturnType<typeof createClient>>

type SoldDealJoin = {
  id: string
  reference: string | null
  stage: string
  owner_profile_id: string | null
  account_id: string | null
  currency?: string | null
  created_at?: string | null
  crm_accounts: { name: string } | { name: string }[] | null
}

export async function countNegativeStockItems(): Promise<number> {
  const supabase = await createClient()
  const [{ count: sourcing }, { count: historical }] = await Promise.all([
    supabase
      .from("sourcing_shortages")
      .select("id", { count: "exact", head: true })
      .in("status", [...NEGATIVE_STOCK_OPEN_STATUSES]),
    supabase
      .from("inventory_shortages")
      .select("id", { count: "exact", head: true })
      .eq("shortage_type", "historical_reconciliation")
      .eq("status", "open"),
  ])
  return (sourcing ?? 0) + (historical ?? 0)
}

export const getNegativeStockRows = cache(async (): Promise<NegativeStockRow[]> => {
  noStore()
  const supabase = await createClient()
  const [sourcingResult, historicalResult, uncoveredDealLines] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("sourcing_shortages")
        .select(
          `
          id, deal_id, deal_line_item_id, package_id, quantity, unit_cost_quoted, currency,
          supplier_id, supplier_quote_at, status, created_at, note,
          packages(id, name, trade_price, location, races(name, season, event_date)),
          suppliers(id, name)
        `,
        )
        .in("status", [...NEGATIVE_STOCK_OPEN_STATUSES])
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("inventory_shortages")
        .select(
          `
          id, deal_id, deal_line_item_id, package_id, quantity, status, created_at, note,
          packages(id, name, trade_price, location, currency, races(name, season, event_date))
        `,
        )
        .eq("shortage_type", "historical_reconciliation")
        .eq("status", "open")
        .order("id")
        .range(from, to),
    ),
    loadSoldDealLines(supabase),
  ])
  const sourcingData = sourcingResult.data
  const historicalData = historicalResult.data

  const dealMap = dealMapFromSoldLines(uncoveredDealLines)
  const dealIds = [
    ...new Set(
      [...sourcingData, ...historicalData, ...uncoveredDealLines]
        .map((row) => row.deal_id)
        .filter(Boolean),
    ),
  ] as string[]
  const missingDealIds = dealIds.filter((id) => !dealMap.has(id))
  if (missingDealIds.length > 0) {
    const extraDeals = await mapChunks(missingDealIds, ID_CHUNK, async (chunk) => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          `
          id, reference, stage, owner_profile_id, account_id,
          crm_accounts(name),
          deal_line_items(id, package_id, quantity, unit_sale_price, expected_unit_cost, sourcing_mode, supplier_id, supplier_quote_at)
        `,
        )
        .in("id", chunk)
      if (error) return [] as ExtraDealRow[]
      return (data ?? []) as ExtraDealRow[]
    })
    for (const deal of extraDeals.flat()) {
      const account = one(deal.crm_accounts)
      dealMap.set(String(deal.id), {
        reference: deal.reference ? String(deal.reference) : null,
        stage: String(deal.stage ?? ""),
        ownerProfileId: deal.owner_profile_id ? String(deal.owner_profile_id) : null,
        ownerName: null,
        accountId: deal.account_id ? String(deal.account_id) : null,
        accountName: account?.name ?? null,
        lines: deal.deal_line_items ?? [],
      })
    }
  }

  const lineIds = [
    ...new Set(
      [
        ...sourcingData.map((row) => row.deal_line_item_id),
        ...historicalData.map((row) => row.deal_line_item_id),
        ...uncoveredDealLines.map((row) => row.id),
      ]
        .map((id) => (id ? String(id) : ""))
        .filter(Boolean),
    ),
  ]
  const allocatedByLine = new Map<string, number>()
  const allocationLookupFailed = new Set<string>()
  const purchasedLineIds = new Set<string>()
  const ownerIds = [
    ...new Set([...dealMap.values()].map((deal) => deal.ownerProfileId).filter(Boolean)),
  ] as string[]

  const ownerName = new Map<string, string>()
  await mapChunks(lineIds, ID_CHUNK, async (chunk) => {
    const { data: allocations, error } = await supabase
      .from("inventory_allocations")
      .select("deal_line_item_id, quantity, state")
      .in("deal_line_item_id", chunk)
      .in("state", ["reserved", "committed"])
    if (error) {
      for (const id of chunk) allocationLookupFailed.add(id)
      return null
    }
    for (const row of allocations ?? []) {
      const id = String(row.deal_line_item_id)
      allocatedByLine.set(id, (allocatedByLine.get(id) ?? 0) + Number(row.quantity ?? 0))
    }
    return null
  })
  const [, , linkedDayPlan] = await Promise.all([
    mapChunks(lineIds, ID_CHUNK, async (chunk) => {
      const { data: purchasedShortages } = await supabase
        .from("sourcing_shortages")
        .select("deal_line_item_id")
        .eq("status", "purchased")
        .in("deal_line_item_id", chunk)
      for (const row of purchasedShortages ?? []) {
        if (row.deal_line_item_id) purchasedLineIds.add(String(row.deal_line_item_id))
      }
      return null
    }),
    mapChunks(ownerIds, ID_CHUNK, async (chunk) => {
      const { data: owners } = await supabase.from("profiles").select("id, full_name").in("id", chunk)
      for (const row of owners ?? []) ownerName.set(row.id, row.full_name ?? "")
      return null
    }),
    loadLinkedDayPlanUncovered(supabase, uncoveredDealLines),
  ])
  for (const deal of dealMap.values()) {
    if (deal.ownerProfileId) deal.ownerName = ownerName.get(deal.ownerProfileId) || null
  }

  const brokeredRows: NegativeStockRow[] = sourcingData.flatMap((row) => {
    const deal = row.deal_id ? dealMap.get(String(row.deal_id)) ?? null : null
    if (!purchaseReadyDeal(deal, row.deal_id ? String(row.deal_id) : null)) return []
    const pkg = one(row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null)
    const race = one(pkg?.races)
    const supplier = one(row.suppliers as { id: string; name: string } | { id: string; name: string }[] | null)
    const line =
      (row.deal_line_item_id
        ? deal?.lines.find((item) => item.id === String(row.deal_line_item_id))
        : null) ??
      deal?.lines.find((item) => item.package_id === row.package_id && item.sourcing_mode === "brokered") ??
      deal?.lines.find((item) => item.package_id === row.package_id) ??
      null
    const unitCost = Number(row.unit_cost_quoted ?? line?.expected_unit_cost ?? 0)
    const unitSale = Number(line?.unit_sale_price ?? pkg?.trade_price ?? 0)
    const eventName = race?.name ? eventSeasonLabel(race.name, race.season) : "Event to source"

    return [
      {
        id: row.id,
        dealId: row.deal_id,
        dealLineItemId: row.deal_line_item_id ? String(row.deal_line_item_id) : line?.id ?? null,
        packageId: row.package_id,
        quantity: Number(row.quantity ?? 0),
        unitCost,
        unitSale,
        currency: row.currency || "USD",
        supplierId: row.supplier_id,
        supplierName: supplier?.name ?? null,
        supplierQuoteAt: row.supplier_quote_at,
        quoteFresh: isSupplierQuoteFresh(row.supplier_quote_at),
        status: (NEGATIVE_STOCK_OPEN_STATUSES.includes(row.status as NegativeStockStatus)
          ? row.status
          : "open") as NegativeStockStatus,
        reason: "brokered" as const,
        createdAt: row.created_at,
        note: row.note,
        eventName,
        eventDate: race?.event_date ?? null,
        location: pkg?.location ?? null,
        packageName: pkg?.name ?? "Package",
        dealReference: deal?.reference ?? (row.deal_id ? `D-${row.deal_id.slice(0, 8).toUpperCase()}` : null),
        accountId: deal?.accountId ?? null,
        accountName: deal?.accountName ?? null,
        ownerName: deal?.ownerName ?? null,
        ownerProfileId: deal?.ownerProfileId ?? null,
      },
    ]
  })

  const historicalRows: NegativeStockRow[] = historicalData.flatMap((row) => {
    const deal = row.deal_id ? dealMap.get(String(row.deal_id)) ?? null : null
    if (!purchaseReadyDeal(deal, row.deal_id ? String(row.deal_id) : null)) return []
    const pkg = one(row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null)
    const race = one(pkg?.races)
    const line =
      deal?.lines.find((item) => item.id === row.deal_line_item_id) ??
      deal?.lines.find((item) => item.package_id === row.package_id) ??
      null
    const lineId = row.deal_line_item_id ? String(row.deal_line_item_id) : line?.id ?? null
    const plannedUncovered =
      lineId && linkedDayPlan.linkedLineIds.has(lineId)
        ? (linkedDayPlan.uncovered.get(lineId) ?? 0)
        : null
    const uncovered = uncoveredSoldQuantity({
      soldQty: Number(line?.quantity ?? row.quantity ?? 0),
      allocatedQty: lineId ? (allocatedByLine.get(lineId) ?? 0) : 0,
      allocationLookupFailed: Boolean(lineId && allocationLookupFailed.has(lineId)),
      plannedUncovered,
      cap: Number(row.quantity ?? 0),
    })
    if (uncovered <= 0) return []
    return [
      {
        id: String(row.id),
        dealId: row.deal_id ? String(row.deal_id) : null,
        dealLineItemId: lineId,
        packageId: String(row.package_id),
        quantity: uncovered,
        unitCost: Number(line?.expected_unit_cost ?? 0),
        unitSale: Number(line?.unit_sale_price ?? pkg?.trade_price ?? 0),
        currency: pkg?.currency || "USD",
        supplierId: null,
        supplierName: null,
        supplierQuoteAt: null,
        quoteFresh: false,
        status: "open" as const,
        reason: "historical_reconciliation" as const,
        createdAt: String(row.created_at),
        note: row.note,
        eventName: race?.name ? eventSeasonLabel(race.name, race.season) : "Event to reconcile",
        eventDate: race?.event_date ?? null,
        location: pkg?.location ?? null,
        packageName: pkg?.name ?? "Package",
        dealReference:
          deal?.reference ??
          (row.deal_id ? `D-${String(row.deal_id).slice(0, 8).toUpperCase()}` : null),
        accountId: deal?.accountId ?? null,
        accountName: deal?.accountName ?? null,
        ownerName: deal?.ownerName ?? null,
        ownerProfileId: deal?.ownerProfileId ?? null,
      },
    ]
  })

  const uncoveredRows: NegativeStockRow[] = uncoveredDealLines.flatMap((row) => {
    const dealJoin = one(
      row.deals as
        | {
            id: string
            reference: string | null
            stage: string
            owner_profile_id: string | null
            account_id: string | null
            currency?: string | null
            crm_accounts: { name: string } | { name: string }[] | null
          }
        | Array<{
            id: string
            reference: string | null
            stage: string
            owner_profile_id: string | null
            account_id: string | null
            currency?: string | null
            crm_accounts: { name: string } | { name: string }[] | null
          }>
        | null,
    )
    if (!dealJoin || !dealStageCountsAsSold(dealJoin.stage)) return []
    const sourcingMode = (row.sourcing_mode ?? "owned") as "owned" | "brokered"
    if (purchasedLineIds.has(String(row.id))) return []
    const plannedUncovered = linkedDayPlan.linkedLineIds.has(String(row.id))
      ? (linkedDayPlan.uncovered.get(String(row.id)) ?? 0)
      : null
    const uncovered = uncoveredSoldQuantity({
      soldQty: Number(row.quantity),
      allocatedQty: allocatedByLine.get(String(row.id)) ?? 0,
      allocationLookupFailed: allocationLookupFailed.has(String(row.id)),
      plannedUncovered,
    })
    if (uncovered <= 0) return []

    const pkg = one(row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null)
    const race = one(pkg?.races)
    const supplier = one(row.suppliers as { id: string; name: string } | { id: string; name: string }[] | null)
    const account = one(dealJoin.crm_accounts)
    const deal = dealMap.get(String(row.deal_id))
    const isBrokered = sourcingMode === "brokered"
    return [
      {
        id: `uncovered:${row.id}`,
        dealId: String(row.deal_id),
        dealLineItemId: String(row.id),
        packageId: String(row.package_id),
        quantity: uncovered,
        unitCost: Number(row.expected_unit_cost ?? 0),
        unitSale: Number(row.unit_sale_price ?? pkg?.trade_price ?? 0),
        currency: pkg?.currency || dealJoin.currency || "USD",
        supplierId: isBrokered && row.supplier_id ? String(row.supplier_id) : null,
        supplierName: isBrokered ? supplier?.name ?? null : null,
        supplierQuoteAt: isBrokered && row.supplier_quote_at ? String(row.supplier_quote_at) : null,
        quoteFresh: isBrokered ? isSupplierQuoteFresh(row.supplier_quote_at) : false,
        status: isBrokered && row.supplier_id && row.expected_unit_cost != null ? "confirmed" : "open",
        reason: isBrokered ? ("brokered" as const) : ("historical_reconciliation" as const),
        createdAt: String(row.created_at),
        note: isBrokered
          ? "Brokered signed sale waiting for purchase"
          : "Signed sale is not covered by purchased stock",
        eventName: race?.name ? eventSeasonLabel(race.name, race.season) : "Event to source",
        eventDate: race?.event_date ?? null,
        location: pkg?.location ?? null,
        packageName: pkg?.name ?? "Package",
        dealReference:
          deal?.reference ??
          (dealJoin.reference ? String(dealJoin.reference) : `D-${String(row.deal_id).slice(0, 8).toUpperCase()}`),
        accountId: deal?.accountId ?? (dealJoin.account_id ? String(dealJoin.account_id) : null),
        accountName: deal?.accountName ?? account?.name ?? null,
        ownerName: deal?.ownerName ?? null,
        ownerProfileId:
          deal?.ownerProfileId ??
          (dealJoin.owner_profile_id ? String(dealJoin.owner_profile_id) : null),
      },
    ]
  })

  return mergeNegativeStockRows([...historicalRows, ...brokeredRows], uncoveredRows)
})

type SoldDealLineRow = {
  id: string
  deal_id: string
  package_id: string
  quantity: number
  unit_sale_price: number | null
  expected_unit_cost: number | null
  sourcing_mode: "owned" | "brokered" | null
  supplier_id: string | null
  supplier_quote_at: string | null
  created_at: string
  deals: unknown
  packages: unknown
  suppliers: unknown
}

function dealMapFromSoldLines(lines: SoldDealLineRow[]): Map<string, DealMapValue> {
  const dealMap = new Map<string, DealMapValue>()
  for (const row of lines) {
    const dealJoin = one(row.deals as SoldDealJoin | SoldDealJoin[] | null)
    if (!dealJoin) continue
    const id = String(row.deal_id)
    const line: DealLineJoin = {
      id: String(row.id),
      package_id: String(row.package_id),
      quantity: row.quantity,
      unit_sale_price: row.unit_sale_price,
      expected_unit_cost: row.expected_unit_cost,
      sourcing_mode: row.sourcing_mode,
      supplier_id: row.supplier_id,
      supplier_quote_at: row.supplier_quote_at,
    }
    const existing = dealMap.get(id)
    if (existing) {
      existing.lines.push(line)
      continue
    }
    const account = one(dealJoin.crm_accounts)
    dealMap.set(id, {
      reference: dealJoin.reference ? String(dealJoin.reference) : null,
      stage: String(dealJoin.stage ?? ""),
      ownerProfileId: dealJoin.owner_profile_id ? String(dealJoin.owner_profile_id) : null,
      ownerName: null,
      accountId: dealJoin.account_id ? String(dealJoin.account_id) : null,
      accountName: account?.name ?? null,
      lines: [line],
    })
  }
  return dealMap
}

async function loadSoldDealLines(supabase: AdminDb): Promise<SoldDealLineRow[]> {
  const { data: soldDeals, error: soldDealsError } = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from("deals")
        .select("id")
        .in("stage", [...DEAL_SOLD_STAGES])
        .order("id")
        .range(from, to),
  )
  if (soldDealsError || soldDeals.length === 0) return []

  const nested = await mapChunks(soldDeals.map((deal) => deal.id), ID_CHUNK, async (chunk) => {
    const { data, error } = await supabase
      .from("deal_line_items")
      .select(
        `
        id, deal_id, package_id, quantity, unit_sale_price, expected_unit_cost,
        sourcing_mode, supplier_id, supplier_quote_at, created_at,
        deals!inner(id, reference, stage, owner_profile_id, account_id, currency, created_at, crm_accounts(name)),
        packages(id, name, trade_price, location, currency, duration, inventory_group_id, inventory_is_standalone, event_date, races(name, season, event_date)),
        suppliers(id, name)
      `,
      )
      .in("deal_id", chunk)
    if (error) return [] as SoldDealLineRow[]
    return (data ?? []) as SoldDealLineRow[]
  })
  return nested.flat()
}

type SoldPackageJoin = {
  duration?: string | null
  inventory_group_id?: string | null
  inventory_is_standalone?: boolean | null
  event_date?: string | null
}

async function loadLinkedDayPlanUncovered(supabase: AdminDb, lines: SoldDealLineRow[]) {
  const planLines = lines.map((row) => {
    const pkg = one(row.packages as SoldPackageJoin | SoldPackageJoin[] | null)
    const deal = one(
      row.deals as
        | { created_at?: string | null; reference?: string | null }
        | Array<{ created_at?: string | null; reference?: string | null }>
        | null,
    )
    return {
      id: String(row.id),
      packageId: String(row.package_id),
      quantity: Number(row.quantity),
      createdAt: String(deal?.created_at ?? row.created_at),
      reference: deal?.reference ? String(deal.reference) : null,
      inventoryGroupId: pkg?.inventory_group_id ?? null,
      standalone: Boolean(pkg?.inventory_is_standalone),
      duration: pkg?.duration ?? null,
      eventDate: pkg?.event_date ?? null,
      sourcingMode: row.sourcing_mode,
    }
  })
  const groupIds = [
    ...new Set(
      planLines
        .map((line) => line.inventoryGroupId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const packageGroup = new Map<string, string>()
  await mapChunks(groupIds, ID_CHUNK, async (chunk) => {
    const { data: groupPackages } = await supabase
      .from("packages")
      .select("id, inventory_group_id, inventory_is_standalone")
      .in("inventory_group_id", chunk)
    for (const pkg of groupPackages ?? []) {
      if (pkg.inventory_is_standalone === true) continue
      const groupId = String(pkg.inventory_group_id ?? "").trim()
      if (!groupId) continue
      packageGroup.set(String(pkg.id), groupId)
    }
    return null
  })
  const purchasedByPackage = new Map<string, number>()
  await mapChunks([...packageGroup.keys()], ID_CHUNK, async (chunk) => {
    const { data: layers } = await supabase
      .from("package_cost_layers")
      .select("package_id, quantity")
      .in("package_id", chunk)
    for (const layer of layers ?? []) {
      const packageId = String(layer.package_id)
      purchasedByPackage.set(
        packageId,
        (purchasedByPackage.get(packageId) ?? 0) + Math.max(0, Math.floor(Number(layer.quantity) || 0)),
      )
    }
    return null
  })
  const stockByGroup = new Map<string, number>()
  const memberCount = new Map<string, number>()
  for (const [packageId, groupId] of packageGroup) {
    memberCount.set(groupId, (memberCount.get(groupId) ?? 0) + 1)
    stockByGroup.set(
      groupId,
      Math.max(stockByGroup.get(groupId) ?? 0, purchasedByPackage.get(packageId) ?? 0),
    )
  }
  const linkedGroupIds = new Set(
    [...memberCount.entries()].filter(([, count]) => count >= 2).map(([groupId]) => groupId),
  )
  return uncoveredQuantitiesFromLinkedDayPlan(planLines, stockByGroup, linkedGroupIds)
}
