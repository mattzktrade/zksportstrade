import {
  ACCOUNT_KIND_OPTIONS,
  type AccountKind,
} from "@/lib/crm/account-kinds"
import { dealStageCountsAsSold } from "@/lib/crm/deal-types"
import {
  enquiryCrmStageFromDeal,
  isDealBoardStage,
} from "@/lib/crm/deal-pipeline"

export type DemandOutcome = "open" | "converted" | "won" | "lost"

export type DemandPlanningLine = {
  dealId: string
  stage: string
  enquiryStage: string | null
  source: string
  accountId: string | null
  accountKinds: AccountKind[]
  eventId: string
  eventName: string
  eventSeason: number | null
  packageId: string
  packageName: string
  quantity: number
}

export type DemandCounts = {
  enquiries: number
  open: number
  converted: number
  won: number
  lost: number
  unitsAsked: number
  unitsOpen: number
  unitsConverted: number
  unitsWon: number
  unitsLost: number
}

export type DemandKindSplit = DemandCounts & {
  kind: AccountKind | "unspecified"
  label: string
}

export type DemandProductRow = DemandCounts & {
  packageId: string
  packageName: string
}

export type DemandEventRow = DemandCounts & {
  eventId: string
  eventName: string
  eventSeason: number | null
  products: DemandProductRow[]
  kinds: DemandKindSplit[]
}

const EMPTY_COUNTS: DemandCounts = {
  enquiries: 0,
  open: 0,
  converted: 0,
  won: 0,
  lost: 0,
  unitsAsked: 0,
  unitsOpen: 0,
  unitsConverted: 0,
  unitsWon: 0,
  unitsLost: 0,
}

export function demandDealOutcome(deal: {
  stage: string
  enquiryStage?: string | null
  enquiry_stage?: string | null
}): DemandOutcome {
  const enquiryStage = deal.enquiryStage ?? deal.enquiry_stage ?? null
  if (
    enquiryCrmStageFromDeal({ stage: deal.stage, enquiry_stage: enquiryStage }) === "not_interested" ||
    deal.stage === "closed_lost" ||
    deal.stage === "cancelled"
  ) {
    return "lost"
  }
  if (dealStageCountsAsSold(deal.stage)) return "won"
  if (isDealBoardStage(deal.stage)) return "converted"
  return "open"
}

export function demandConversionRate(counts: Pick<DemandCounts, "enquiries" | "converted">): number {
  if (counts.enquiries <= 0) return 0
  return counts.converted / counts.enquiries
}

export function demandWinRate(counts: Pick<DemandCounts, "enquiries" | "won">): number {
  if (counts.enquiries <= 0) return 0
  return counts.won / counts.enquiries
}

function addDeal(set: Set<string>, dealId: string, counts: DemandCounts, field: keyof DemandCounts) {
  if (field === "enquiries" || field === "open" || field === "converted" || field === "won" || field === "lost") {
    if (set.has(dealId)) return
    set.add(dealId)
    counts[field] += 1
  }
}

function bumpUnits(counts: DemandCounts, outcome: DemandOutcome, quantity: number) {
  counts.unitsAsked += quantity
  if (outcome === "open") counts.unitsOpen += quantity
  if (outcome === "converted") counts.unitsConverted += quantity
  if (outcome === "won") {
    counts.unitsConverted += quantity
    counts.unitsWon += quantity
  }
  if (outcome === "lost") counts.unitsLost += quantity
}

function emptyBucket() {
  return {
    counts: { ...EMPTY_COUNTS },
    enquiryIds: new Set<string>(),
    openIds: new Set<string>(),
    convertedIds: new Set<string>(),
    wonIds: new Set<string>(),
    lostIds: new Set<string>(),
  }
}

type Bucket = ReturnType<typeof emptyBucket>

function applyLine(bucket: Bucket, dealId: string, outcome: DemandOutcome, quantity: number) {
  addDeal(bucket.enquiryIds, dealId, bucket.counts, "enquiries")
  if (outcome === "open") addDeal(bucket.openIds, dealId, bucket.counts, "open")
  if (outcome === "converted" || outcome === "won") {
    addDeal(bucket.convertedIds, dealId, bucket.counts, "converted")
  }
  if (outcome === "won") addDeal(bucket.wonIds, dealId, bucket.counts, "won")
  if (outcome === "lost") addDeal(bucket.lostIds, dealId, bucket.counts, "lost")
  bumpUnits(bucket.counts, outcome, quantity)
}

function kindLabel(kind: AccountKind | "unspecified"): string {
  if (kind === "unspecified") return "Unspecified"
  return ACCOUNT_KIND_OPTIONS.find((option) => option.id === kind)?.label ?? kind
}

export function lineMatchesClientFilter(
  line: Pick<DemandPlanningLine, "accountKinds">,
  selectedKinds: Array<AccountKind | "unspecified">,
): boolean {
  if (selectedKinds.length === 0) return true
  if (line.accountKinds.length === 0) return selectedKinds.includes("unspecified")
  return line.accountKinds.some((kind) => selectedKinds.includes(kind))
}

export function aggregateDemand(
  lines: DemandPlanningLine[],
  selectedKinds: Array<AccountKind | "unspecified"> = [],
): { totals: DemandCounts; events: DemandEventRow[] } {
  const scoped = lines.filter((line) => lineMatchesClientFilter(line, selectedKinds))
  const eventBuckets = new Map<string, Bucket & { eventName: string; eventSeason: number | null; products: Map<string, Bucket & { packageName: string }>; kinds: Map<string, Bucket> }>()
  const totals = emptyBucket()

  for (const line of scoped) {
    const outcome = demandDealOutcome({ stage: line.stage, enquiryStage: line.enquiryStage })
    const qty = Math.max(0, line.quantity)
    applyLine(totals, line.dealId, outcome, qty)

    const event = eventBuckets.get(line.eventId) ?? {
      ...emptyBucket(),
      eventName: line.eventName,
      eventSeason: line.eventSeason,
      products: new Map(),
      kinds: new Map(),
    }
    applyLine(event, line.dealId, outcome, qty)

    const product = event.products.get(line.packageId) ?? {
      ...emptyBucket(),
      packageName: line.packageName,
    }
    applyLine(product, line.dealId, outcome, qty)
    event.products.set(line.packageId, product)

    for (const kind of line.accountKinds.length ? line.accountKinds : (["unspecified"] as const)) {
      const key = kind === "unspecified" ? "unspecified" : kind
      const kindBucket = event.kinds.get(key) ?? emptyBucket()
      applyLine(kindBucket, line.dealId, outcome, qty)
      event.kinds.set(key, kindBucket)
    }

    eventBuckets.set(line.eventId, event)
  }

  const events: DemandEventRow[] = [...eventBuckets.entries()]
    .map(([eventId, event]) => ({
      eventId,
      eventName: event.eventName,
      eventSeason: event.eventSeason,
      ...event.counts,
      products: [...event.products.entries()]
        .map(([packageId, product]) => ({
          packageId,
          packageName: product.packageName,
          ...product.counts,
        }))
        .sort((a, b) => b.enquiries - a.enquiries || a.packageName.localeCompare(b.packageName)),
      kinds: [...event.kinds.entries()]
        .map(([kind, bucket]) => ({
          kind: kind as AccountKind | "unspecified",
          label: kindLabel(kind as AccountKind | "unspecified"),
          ...bucket.counts,
        }))
        .sort((a, b) => b.enquiries - a.enquiries || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.enquiries - a.enquiries || a.eventName.localeCompare(b.eventName))

  return { totals: totals.counts, events }
}

export function demandClientFilterOptions(): Array<{ id: AccountKind | "unspecified" | "agents"; label: string }> {
  return [
    { id: "direct_client", label: "Direct" },
    { id: "agents", label: "Agents" },
    ...ACCOUNT_KIND_OPTIONS.filter((option) => option.id !== "direct_client" && option.id !== "supplier"),
    { id: "unspecified", label: "Unspecified" },
  ]
}

export const DEMAND_AGENT_KINDS: AccountKind[] = [
  "concierge",
  "travel_agency",
  "ticket_agent",
  "hospitality_agency",
]
