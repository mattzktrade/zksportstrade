import { unstable_noStore as noStore } from "next/cache"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { createClient } from "@/lib/supabase/server"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { parseAccountKinds, type AccountKind } from "@/lib/crm/account-kinds"
import type { DemandPlanningLine } from "@/lib/crm/demand-planning"

async function fetchInChunks<T>(
  ids: string[],
  run: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(await run(ids.slice(i, i + 200))))
  }
  return out
}

type DealHead = {
  id: string
  stage: string
  enquiry_stage?: string | null
  source: string | null
  account_id: string | null
  race_id: string | null
}

type DealLineRow = {
  deal_id: string
  package_id: string | null
  quantity: number | null
}

type PackageRow = {
  id: string
  name: string | null
  race_id: string | null
}

type RaceRow = {
  id: string
  name: string | null
  season: number | null
}

type OrderHead = {
  id: string
  deal_id: string | null
  crm_account_id: string | null
  package_id: string | null
  status: string | null
  guests: number | null
}

type OrderLineRow = {
  order_id: string
  package_id: string | null
  quantity: number | null
}

function eventFrom(
  raceId: string | null | undefined,
  races: Map<string, RaceRow>,
): { eventId: string; eventName: string; eventSeason: number | null } {
  const id = raceId?.trim() || ""
  if (!id) return { eventId: "unspecified", eventName: "No event", eventSeason: null }
  const race = races.get(id)
  return {
    eventId: id,
    eventName: race?.name?.trim() ? eventSeasonLabel(race.name, race.season) : "No event",
    eventSeason: race?.season ?? null,
  }
}

export async function getDemandPlanningLines(): Promise<DemandPlanningLine[]> {
  noStore()
  const supabase = await createClient()

  async function loadDeals(select: string) {
    return fetchAllRows<DealHead>((from, to) =>
      supabase.from("deals").select(select as never).order("id").range(from, to) as PromiseLike<{
        data: DealHead[] | null
        error: { message: string } | null
      }>,
    )
  }

  let { data: deals, error: dealError } = await loadDeals(
    "id, stage, enquiry_stage, source, account_id, race_id",
  )
  if (dealError && /enquiry_stage|schema cache/i.test(dealError.message)) {
    ;({ data: deals, error: dealError } = await loadDeals("id, stage, source, account_id, race_id"))
  }
  if (dealError || !deals) deals = []

  const { data: dealLines, error: lineError } = await fetchAllRows<DealLineRow>((from, to) =>
    supabase
      .from("deal_line_items")
      .select("deal_id, package_id, quantity")
      .order("id")
      .range(from, to),
  )
  const linesByDeal = new Map<string, DealLineRow[]>()
  if (!lineError) {
    for (const line of dealLines) {
      const dealId = String(line.deal_id)
      const list = linesByDeal.get(dealId) ?? []
      list.push(line)
      linesByDeal.set(dealId, list)
    }
  }

  const { data: orders } = await fetchAllRows<OrderHead>((from, to) =>
    supabase
      .from("orders")
      .select("id, deal_id, crm_account_id, package_id, status, guests")
      .order("id")
      .range(from, to),
  )
  const liveOrders = (orders ?? []).filter((order) => order.status !== "cancelled")
  const orderIds = liveOrders.map((order) => String(order.id))
  const orderLines = await fetchInChunks<OrderLineRow>(orderIds, async (chunk) => {
    const { data } = await supabase
      .from("order_line_items")
      .select("order_id, package_id, quantity")
      .in("order_id", chunk)
    return (data ?? []) as OrderLineRow[]
  })
  const linesByOrder = new Map<string, OrderLineRow[]>()
  for (const line of orderLines) {
    const orderId = String(line.order_id)
    const list = linesByOrder.get(orderId) ?? []
    list.push(line)
    linesByOrder.set(orderId, list)
  }

  const packageIds = [
    ...new Set(
      [
        ...[...linesByDeal.values()].flat().map((line) => line.package_id),
        ...orderLines.map((line) => line.package_id),
        ...liveOrders.map((order) => order.package_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]
  const packages = await fetchInChunks<PackageRow>(packageIds, async (chunk) => {
    const { data } = await supabase.from("packages").select("id, name, race_id").in("id", chunk)
    return (data ?? []) as PackageRow[]
  })
  const packagesById = new Map(packages.map((row) => [String(row.id), row]))

  const raceIds = [
    ...new Set(
      [
        ...deals.map((deal) => deal.race_id),
        ...packages.map((row) => row.race_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]
  const races = await fetchInChunks<RaceRow>(raceIds, async (chunk) => {
    const { data } = await supabase.from("races").select("id, name, season").in("id", chunk)
    return (data ?? []) as RaceRow[]
  })
  const racesById = new Map(races.map((row) => [String(row.id), row]))

  const accountIds = [
    ...new Set(
      [
        ...deals.map((deal) => deal.account_id),
        ...liveOrders.map((order) => order.crm_account_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]
  const kindsByAccount = new Map<string, AccountKind[]>()
  const accounts = await fetchInChunks<{ id: string; account_types: unknown }>(accountIds, async (chunk) => {
    const { data } = await supabase.from("crm_accounts").select("id, account_types").in("id", chunk)
    return (data ?? []) as Array<{ id: string; account_types: unknown }>
  })
  for (const account of accounts) {
    kindsByAccount.set(String(account.id), parseAccountKinds(account.account_types))
  }

  const result: DemandPlanningLine[] = []
  const dealIds = new Set(deals.map((deal) => String(deal.id)))

  function pushLine(input: {
    recordId: string
    stage: string
    enquiryStage: string | null
    source: string
    accountId: string | null
    packageId: string | null
    quantity: number
    fallbackRaceId: string | null
  }) {
    const pkg = input.packageId ? packagesById.get(input.packageId) : null
    const event = eventFrom(pkg?.race_id || input.fallbackRaceId, racesById)
    result.push({
      dealId: input.recordId,
      stage: input.stage,
      enquiryStage: input.enquiryStage,
      source: input.source,
      accountId: input.accountId,
      accountKinds: input.accountId ? kindsByAccount.get(input.accountId) ?? [] : [],
      eventId: event.eventId,
      eventName: event.eventName,
      eventSeason: event.eventSeason,
      packageId: input.packageId || pkg?.id || "unspecified",
      packageName: pkg?.name?.trim() || "No product",
      quantity: input.quantity,
    })
  }

  for (const deal of deals) {
    const items = linesByDeal.get(String(deal.id)) ?? []
    if (items.length === 0) {
      pushLine({
        recordId: deal.id,
        stage: deal.stage,
        enquiryStage: deal.enquiry_stage ?? null,
        source: deal.source || "other",
        accountId: deal.account_id,
        packageId: null,
        quantity: 0,
        fallbackRaceId: deal.race_id,
      })
      continue
    }
    for (const item of items) {
      pushLine({
        recordId: deal.id,
        stage: deal.stage,
        enquiryStage: deal.enquiry_stage ?? null,
        source: deal.source || "other",
        accountId: deal.account_id,
        packageId: item.package_id,
        quantity: Number(item.quantity) || 0,
        fallbackRaceId: deal.race_id,
      })
    }
  }

  for (const order of liveOrders) {
    const dealId = order.deal_id ? String(order.deal_id) : ""
    if (dealId && dealIds.has(dealId)) continue
    const stage = order.status === "confirmed" ? "paid_confirmed" : "awaiting_client_signature"
    const items = linesByOrder.get(String(order.id)) ?? []
    const fallbackQty = Math.max(0, Number(order.guests) || 0)
    if (items.length === 0) {
      pushLine({
        recordId: `order:${order.id}`,
        stage,
        enquiryStage: null,
        source: "portal",
        accountId: order.crm_account_id,
        packageId: order.package_id,
        quantity: fallbackQty || 1,
        fallbackRaceId: null,
      })
      continue
    }
    for (const item of items) {
      pushLine({
        recordId: `order:${order.id}`,
        stage,
        enquiryStage: null,
        source: "portal",
        accountId: order.crm_account_id,
        packageId: item.package_id,
        quantity: Number(item.quantity) || 0,
        fallbackRaceId: null,
      })
    }
  }

  return result
}
