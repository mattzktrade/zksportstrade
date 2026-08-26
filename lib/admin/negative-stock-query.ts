import { unstable_noStore as noStore } from "next/cache"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { isSupplierQuoteFresh } from "@/lib/inventory/native-availability"
import { createClient } from "@/lib/supabase/server"
import {
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

export async function getNegativeStockRows(): Promise<NegativeStockRow[]> {
  noStore()
  const supabase = await createClient()
  const { data: sourcingData } = await supabase
    .from("sourcing_shortages")
    .select(
      `
      id, deal_id, package_id, quantity, unit_cost_quoted, currency,
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

  const dealIds = [
    ...new Set(
      [...(sourcingData ?? []), ...(historicalData ?? [])]
        .map((row) => row.deal_id)
        .filter(Boolean),
    ),
  ] as string[]
  const { data: deals } = dealIds.length
    ? await supabase
        .from("deals")
        .select(
          `
          id, reference, owner_profile_id, account_id,
          crm_accounts(name),
          deal_line_items(id, package_id, unit_sale_price, expected_unit_cost, sourcing_mode)
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

  const ownerName = new Map((owners ?? []).map((row) => [row.id, row.full_name ?? ""]))
  const dealMap = new Map(
    (deals ?? []).map((deal) => {
      const account = one(deal.crm_accounts as { name: string } | { name: string }[] | null)
      const lines = (deal.deal_line_items ?? []) as Array<{
        id: string
        package_id: string
        unit_sale_price: number | null
        expected_unit_cost: number | null
        sourcing_mode: "owned" | "brokered" | null
      }>
      return [
        String(deal.id),
        {
          reference: deal.reference ? String(deal.reference) : null,
          ownerProfileId: deal.owner_profile_id ? String(deal.owner_profile_id) : null,
          ownerName: deal.owner_profile_id ? ownerName.get(String(deal.owner_profile_id)) || null : null,
          accountId: deal.account_id ? String(deal.account_id) : null,
          accountName: account?.name ?? null,
          lines,
        },
      ] as const
    }),
  )

  const brokeredRows: NegativeStockRow[] = (sourcingData ?? []).map((row) => {
    const pkg = one(
      row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null,
    )
    const race = one(pkg?.races)
    const supplier = one(row.suppliers as { id: string; name: string } | { id: string; name: string }[] | null)
    const deal = row.deal_id ? dealMap.get(String(row.deal_id)) : null
    const line =
      deal?.lines.find((item) => item.package_id === row.package_id && item.sourcing_mode === "brokered") ??
      deal?.lines.find((item) => item.package_id === row.package_id) ??
      null
    const unitCost = Number(row.unit_cost_quoted ?? line?.expected_unit_cost ?? 0)
    const unitSale = Number(line?.unit_sale_price ?? pkg?.trade_price ?? 0)
    const eventName = race?.name ? eventSeasonLabel(race.name, race.season) : "Event to source"

    return {
      id: row.id,
      dealId: row.deal_id,
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
    }
  })

  const historicalRows: NegativeStockRow[] = (historicalData ?? []).map((row) => {
    const pkg = one(row.packages as ShortagePackageJoin | ShortagePackageJoin[] | null)
    const race = one(pkg?.races)
    const deal = row.deal_id ? dealMap.get(String(row.deal_id)) : null
    const line =
      deal?.lines.find((item) => item.id === row.deal_line_item_id) ??
      deal?.lines.find((item) => item.package_id === row.package_id) ??
      null
    return {
      id: String(row.id),
      dealId: row.deal_id ? String(row.deal_id) : null,
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
    }
  })

  return [...historicalRows, ...brokeredRows]
}
