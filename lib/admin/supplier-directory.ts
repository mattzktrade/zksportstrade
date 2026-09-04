import {
  accountKindLabels,
  parseAccountKinds,
  type AccountKind,
} from "@/lib/crm/account-kinds"
import {
  EVENT_CATEGORY_LABELS,
  isEventCategory,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import {
  regionIdForLocation,
  regionNameForId,
  type CatalogRegionId,
} from "@/lib/catalog/regions"

export const SUPPLIER_TIER1_COUNT = 10
export const SUPPLIER_TIER2_COUNT = 20

export type SupplierTier = 1 | 2 | 3

export type SupplierCoverageEvent = {
  raceId: string
  name: string
  shortName: string
  season: number | null
  eventDate: string | null
  label: string
  category: EventCategory
  country: string
  location: string
  regionId: CatalogRegionId | null
  packages: string[]
  spend: number
}

export type SupplierCoverageSummary = {
  headline: string
  detail: string
}

export type SupplierDirectoryRow = {
  id: string
  name: string
  code: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  active: boolean
  purchaseOrders: number
  packages: string[]
  spend: number
  currency: string
  accountKinds: AccountKind[]
  accountKindLabel: string
  tier: SupplierTier
  events: SupplierCoverageEvent[]
}

export type SupplierDirectoryFilters = {
  search: string
  sport: string
  eventIds: string[]
}

export type SupplierDirectorySource = {
  id: string
  name: string
  code: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  active: boolean
  accountKinds: AccountKind[] | unknown
}

export type SupplierDirectoryLayer = {
  supplierId: string | null
  quantity: number
  unitCost: number
  currency: string
  packageName: string | null
  raceId: string | null
}

export type SupplierDirectoryCoverage = {
  supplierId: string
  raceId: string
}

export type SupplierDirectoryRace = {
  id: string
  name: string
  shortName: string
  season: number | null
  eventDate: string | null
  category: string
  country: string
  location: string
}

export const EMPTY_SUPPLIER_DIRECTORY_FILTERS: SupplierDirectoryFilters = {
  search: "",
  sport: "",
  eventIds: [],
}

export function supplierTierLabel(tier: SupplierTier): string {
  return `Tier ${tier}`
}

export function supplierTierTone(tier: SupplierTier): "green" | "blue" | "amber" {
  if (tier === 1) return "green"
  if (tier === 2) return "blue"
  return "amber"
}

export function assignSupplierTiers<T extends { id: string; spend: number }>(rows: T[]): Map<string, SupplierTier> {
  const ranked = [...rows].sort((a, b) => b.spend - a.spend || a.id.localeCompare(b.id))
  const tiers = new Map<string, SupplierTier>()
  let paidIndex = 0
  for (const row of ranked) {
    if (row.spend <= 0) {
      tiers.set(row.id, 3)
      continue
    }
    if (paidIndex < SUPPLIER_TIER1_COUNT) tiers.set(row.id, 1)
    else if (paidIndex < SUPPLIER_TIER1_COUNT + SUPPLIER_TIER2_COUNT) tiers.set(row.id, 2)
    else tiers.set(row.id, 3)
    paidIndex += 1
  }
  return tiers
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )
}

function displayEventName(event: Pick<SupplierCoverageEvent, "name" | "shortName" | "season">): string {
  return eventSeasonLabel(event.shortName || event.name, event.season)
}

function eventMatchesQuery(event: SupplierCoverageEvent, query: string): boolean {
  const regionName = regionNameForId(event.regionId) ?? ""
  return [
    event.label,
    event.name,
    event.shortName,
    event.country,
    event.location,
    regionName,
    EVENT_CATEGORY_LABELS[event.category],
    ...event.packages,
  ].some((value) => value.toLowerCase().includes(query))
}

export function focusedCoverageEvents(
  events: SupplierCoverageEvent[],
  filters: Pick<SupplierDirectoryFilters, "search" | "sport" | "eventIds">,
): SupplierCoverageEvent[] {
  let focused = events
  if (filters.eventIds.length > 0) {
    const selected = new Set(filters.eventIds)
    focused = focused.filter((event) => selected.has(event.raceId))
  }
  if (filters.sport) {
    focused = focused.filter((event) => event.category === filters.sport)
  }
  const query = filters.search.trim().toLowerCase()
  if (query) {
    const matched = focused.filter((event) => eventMatchesQuery(event, query))
    if (matched.length > 0) focused = matched
  }
  return focused.length > 0 ? focused : events
}

export function summarizeSupplierCoverage(events: SupplierCoverageEvent[]): SupplierCoverageSummary {
  if (events.length === 0) {
    return { headline: "No coverage saved", detail: "Add events on the supplier page" }
  }

  const ranked = [...events].sort((a, b) => b.spend - a.spend || a.label.localeCompare(b.label))
  const packages = uniqueSorted(ranked.flatMap((event) => event.packages))
  const sports = uniqueSorted(ranked.map((event) => event.category))
  const regionCounts = new Map<CatalogRegionId, { count: number; spend: number }>()
  for (const event of ranked) {
    if (!event.regionId) continue
    const current = regionCounts.get(event.regionId) ?? { count: 0, spend: 0 }
    current.count += 1
    current.spend += event.spend
    regionCounts.set(event.regionId, current)
  }
  const topRegion = [...regionCounts.entries()].sort(
    (a, b) => b[1].spend - a[1].spend || b[1].count - a[1].count,
  )[0]

  const packageDetail = packages.slice(0, 3).join(", ")
  const extraEvents = ranked.length > 2 ? `+${ranked.length - 2} more events` : ""

  if (sports.length === 1 && ranked.length >= 5 && regionCounts.size >= 2) {
    return {
      headline: EVENT_CATEGORY_LABELS[sports[0] as EventCategory] ?? "Multi-event",
      detail: packageDetail || ranked.slice(0, 3).map(displayEventName).join(", "),
    }
  }

  if (topRegion && topRegion[1].count >= 3) {
    const regionEvents = ranked.filter((event) => event.regionId === topRegion[0])
    return {
      headline: regionNameForId(topRegion[0]) ?? "Regional",
      detail: packageDetail || regionEvents.slice(0, 3).map(displayEventName).join(", "),
    }
  }

  const topEvents = ranked.slice(0, 2)
  const topPackages = uniqueSorted(topEvents.flatMap((event) => event.packages)).slice(0, 3)
  return {
    headline: topEvents.map(displayEventName).join(" · "),
    detail: topPackages.join(", ") || extraEvents,
  }
}

export function coverageForFilters(
  events: SupplierCoverageEvent[],
  filters: Pick<SupplierDirectoryFilters, "search" | "sport" | "eventIds">,
): SupplierCoverageSummary {
  return summarizeSupplierCoverage(focusedCoverageEvents(events, filters))
}

export function supplierMatchesDirectoryFilters(
  row: SupplierDirectoryRow,
  filters: SupplierDirectoryFilters,
): boolean {
  if (filters.sport && !row.events.some((event) => event.category === filters.sport)) return false
  if (filters.eventIds.length > 0) {
    const selected = new Set(filters.eventIds)
    if (!row.events.some((event) => selected.has(event.raceId))) return false
  }
  const query = filters.search.trim().toLowerCase()
  if (!query) return true
  const identityHit = [
    row.name,
    row.code,
    row.contactName,
    row.contactEmail,
    row.accountKindLabel,
    ...row.packages,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query))
  if (identityHit) return true
  return row.events.some((event) => eventMatchesQuery(event, query))
}

export function supplierDirectoryEventOptions(rows: SupplierDirectoryRow[]): Array<{
  id: string
  label: string
  eventDate: string | null
}> {
  const byId = new Map<string, { id: string; label: string; eventDate: string | null }>()
  for (const row of rows) {
    for (const event of row.events) {
      if (!event.raceId || byId.has(event.raceId)) continue
      byId.set(event.raceId, { id: event.raceId, label: event.label, eventDate: event.eventDate })
    }
  }
  return [...byId.values()]
}

function raceToCoverageEvent(race: SupplierDirectoryRace): SupplierCoverageEvent {
  const category = isEventCategory(race.category) ? race.category : "other"
  return {
    raceId: race.id,
    name: race.name,
    shortName: race.shortName || race.name,
    season: race.season,
    eventDate: race.eventDate,
    label: eventSeasonLabel(race.name, race.season),
    category,
    country: race.country,
    location: race.location,
    regionId: regionIdForLocation(race.country, race.location),
    packages: [],
    spend: 0,
  }
}

export function buildSupplierDirectoryRows(input: {
  suppliers: SupplierDirectorySource[]
  purchaseOrderCounts: Map<string, number>
  layers: SupplierDirectoryLayer[]
  coverage: SupplierDirectoryCoverage[]
  races: SupplierDirectoryRace[]
}): SupplierDirectoryRow[] {
  const raceById = new Map(input.races.map((race) => [race.id, race]))
  const eventsBySupplier = new Map<string, Map<string, SupplierCoverageEvent>>()
  const packagesBySupplier = new Map<string, Set<string>>()
  const spendBySupplier = new Map<string, number>()
  const currencyBySupplier = new Map<string, string>()

  function eventBucket(supplierId: string, raceId: string, fallback?: SupplierDirectoryRace | null): SupplierCoverageEvent | null {
    const race = raceById.get(raceId) ?? fallback ?? null
    if (!race) return null
    const byRace = eventsBySupplier.get(supplierId) ?? new Map<string, SupplierCoverageEvent>()
    const current = byRace.get(raceId) ?? raceToCoverageEvent(race)
    byRace.set(raceId, current)
    eventsBySupplier.set(supplierId, byRace)
    return current
  }

  for (const row of input.coverage) {
    if (!row.supplierId || !row.raceId) continue
    eventBucket(row.supplierId, row.raceId)
  }

  for (const layer of input.layers) {
    if (!layer.supplierId) continue
    const spend = Math.max(0, Number(layer.quantity ?? 0)) * Math.max(0, Number(layer.unitCost ?? 0))
    spendBySupplier.set(layer.supplierId, (spendBySupplier.get(layer.supplierId) ?? 0) + spend)
    if (layer.currency) currencyBySupplier.set(layer.supplierId, layer.currency)
    const packageName = layer.packageName?.trim() || null
    if (packageName) {
      const names = packagesBySupplier.get(layer.supplierId) ?? new Set<string>()
      names.add(packageName)
      packagesBySupplier.set(layer.supplierId, names)
    }
    if (!layer.raceId) continue
    const event = eventBucket(layer.supplierId, layer.raceId)
    if (!event) continue
    event.spend += spend
    if (packageName && !event.packages.includes(packageName)) event.packages.push(packageName)
  }

  const draft = input.suppliers.map((supplier) => {
    const accountKinds = parseAccountKinds(supplier.accountKinds)
    const events = [...(eventsBySupplier.get(supplier.id)?.values() ?? [])].sort(
      (a, b) => b.spend - a.spend || a.label.localeCompare(b.label),
    )
    for (const event of events) event.packages.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    return {
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      contactName: supplier.contactName,
      contactEmail: supplier.contactEmail,
      contactPhone: supplier.contactPhone,
      notes: supplier.notes,
      active: supplier.active,
      purchaseOrders: input.purchaseOrderCounts.get(supplier.id) ?? 0,
      packages: [...(packagesBySupplier.get(supplier.id) ?? new Set<string>())].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
      spend: spendBySupplier.get(supplier.id) ?? 0,
      currency: currencyBySupplier.get(supplier.id) ?? "USD",
      accountKinds,
      accountKindLabel: accountKindLabels(accountKinds),
      tier: 3 as SupplierTier,
      events,
    }
  })

  const tiers = assignSupplierTiers(draft)
  return draft
    .map((row) => ({ ...row, tier: tiers.get(row.id) ?? 3 }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(b.active) - Number(a.active) ||
        b.spend - a.spend ||
        a.name.localeCompare(b.name),
    )
}
