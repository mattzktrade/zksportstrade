import { unstable_noStore as noStore } from "next/cache"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { dealStageCountsAsSold, DEAL_SOLD_STAGES } from "@/lib/crm/deal-types"
import { isSupplierQuoteFresh } from "@/lib/inventory/native-availability"
import { chunkList, fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import {
  mergeNegativeStockRows,
  NEGATIVE_STOCK_OPEN_STATUSES,
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

function purchaseReadyDeal(deal: DealMapValue | null, dealId: string | null): boolean {
  if (!dealId) return true
  if (!deal) return false
  return dealStageCountsAsSold(deal.stage)
}

export async function getNegativeStockRows(): Promise<NegativeStockRow[]> {
  noStore()
  const supabase = await createClient()
  const { data: sourcingData } = await supabase
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
    .order("created_at", { ascending: false })

  const { data: historicalData } = await supabase
    .from("inventory_shortages")
    .select(
      `
      id, deal_id, deal_line_item_id, package_id, quantity, status, created_at, note,
      packages(id, name, trade_price, location, currency, races(name, season, event_date))
    `,
    )
    .eq("shortage_type", "historical_reconciliation")
    .eq("status", "open")
    .order("created_at", { ascending: false })

  const uncoveredDealLines = await loadSoldDealLines(supabase)

  const dealIds = [
    ...new Set(
      [...(sourcingData ?? []), ...(historicalData ?? []), ...uncoveredDealLines]
        .map((row) => row.deal_id)
        .filter(Boolean),
    ),
  ] as string[]
  const { data: deals } = dealIds.length
    ? await supabase
        .from("deals")
        .select(
          `
          id, reference, stage, owner_profile_id, account_id,
          crm_accounts(name),
          deal_line_items(id, package_id, unit_sale_price, expected_unit_cost, sourcing_mode, supplier_id, supplier_quote_at)
        `,
        )
        .in("id", dealIds)
    : { data: [] as Array<Record<string, unknown>> }

  const ownerIds = [
    ...new Set((deals ?? []).map((deal) => deal.owner_profile_id).filter(Boolean)),
  ] as string[]
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ownerIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> }

  const lineIds = [
    ...new Set(
      [
        ...(sourcingData ?? []).map((row) => row.deal_line_item_id),
        ...(historicalData ?? []).map((row) => row.deal_line_item_id),
        ...(uncoveredDealLines ?? []).map((row) => row.id),
      ]
        .map((id) => (id ? String(id) : ""))
        .filter(Boolean),
    ),
  ]
  const { data: allocations } = lineIds.length
    ? await supabase
        .from("inventory_allocations")
        .select("deal_line_item_id, quantity, state")
        .in("deal_line_item_id", lineIds)
        .in("state", ["reserved", "committed"])
    : { data: [] as Array<{ deal_line_item_id: string; quantity: number; state: string }> }

  const allocatedByLine = new Map<string, number>()
  for (const row of allocations ?? []) {
    const id = String(row.deal_line_item_id)
    allocatedByLine.set(id, (allocatedByLine.get(id) ?? 0) + Number(row.quantity ?? 0))
  }

  const purchasedLineIds = new Set<string>()
  for (const chunk of chunkList(lineIds, 80)) {
    const { data: purchasedShortages } = await supabase
      .from("sourcing_shortages")
      .select("deal_line_item_id")
      .eq("status", "purchased")
      .in("deal_line_item_id", chunk)
    for (const row of purchasedShortages ?? []) {
      if (row.deal_line_item_id) purchasedLineIds.add(String(row.deal_line_item_id))
    }
  }

  const ownerName = new Map((owners ?? []).map((row) => [row.id, row.full_name ?? ""]))
  const dealMap = new Map(
    (deals ?? []).map((deal) => {
      const account = one(deal.crm_accounts as { name: string } | { name: string }[] | null)
      const lines = (deal.deal_line_items ?? []) as DealLineJoin[]
      return [
        String(deal.id),
        {
          reference: deal.reference ? String(deal.reference) : null,
          stage: String(deal.stage ?? ""),
          ownerProfileId: deal.owner_profile_id ? String(deal.owner_profile_id) : null,
          ownerName: deal.owner_profile_id ? ownerName.get(String(deal.owner_profile_id)) || null : null,
          accountId: deal.account_id ? String(deal.account_id) : null,
          accountName: account?.name ?? null,
          lines,
        } satisfies DealMapValue,
      ] as const
    }),
  )

  const brokeredRows: NegativeStockRow[] = (sourcingData ?? []).flatMap((row) => {
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

  const historicalRows: NegativeStockRow[] = (historicalData ?? []).flatMap((row) => {
    const deal = row.deal_id ? dealMap.get(String(row.deal_id)) ?? null : null
    if (!purchaseReadyDeal(deal, row.deal_id ? String(row.deal_id) : null)) return []
    const pkg = one(row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null)
    const race = one(pkg?.races)
    const line =
      deal?.lines.find((item) => item.id === row.deal_line_item_id) ??
      deal?.lines.find((item) => item.package_id === row.package_id) ??
      null
    return [
      {
        id: String(row.id),
        dealId: row.deal_id ? String(row.deal_id) : null,
        dealLineItemId: row.deal_line_item_id ? String(row.deal_line_item_id) : line?.id ?? null,
        packageId: String(row.package_id),
        quantity: Number(row.quantity ?? 0),
        unitCost: Number(line?.expected_unit_cost ?? 0),
        unitSale: Number(line?.unit_sale_price ?? pkg?.trade_price ?? 0),
        currency: pkg?.currency || "USD",
        supplierId: null,
        supplierName: null,
        supplierQuoteAt: null,
        quoteFresh: false,
        status: "open",
        reason: "historical_reconciliation",
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
    const allocated = allocatedByLine.get(String(row.id)) ?? 0
    const uncovered = Math.max(0, Math.floor(Number(row.quantity) || 0) - allocated)
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
}

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

async function loadSoldDealLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SoldDealLineRow[]> {
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

  const lines: SoldDealLineRow[] = []
  for (const chunk of chunkList(
    soldDeals.map((deal) => deal.id),
    80,
  )) {
    const { data, error } = await supabase
      .from("deal_line_items")
      .select(
        `
        id, deal_id, package_id, quantity, unit_sale_price, expected_unit_cost,
        sourcing_mode, supplier_id, supplier_quote_at, created_at,
        deals!inner(id, reference, stage, owner_profile_id, account_id, currency, crm_accounts(name)),
        packages(id, name, trade_price, location, currency, races(name, season, event_date)),
        suppliers(id, name)
      `,
      )
      .in("deal_id", chunk)
    if (error) continue
    lines.push(...((data ?? []) as SoldDealLineRow[]))
  }
  return lines
}
