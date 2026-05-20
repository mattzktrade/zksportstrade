import type { Package, Race } from "@/lib/types/catalog"
import { bookableEventDateFrom } from "@/lib/catalog/bookable-events"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"
import {
  buildPortalSeasonSlices,
  DEFAULT_PORTAL_SEASON,
  type PortalCatalog,
} from "@/lib/catalog/portal-catalog"
import { INVENTORY_COLUMNS, PACKAGE_COLUMNS, RACE_COLUMNS } from "@/lib/catalog/columns"
import { createClient } from "@/lib/supabase/server"
import {
  buildCatalog,
  mapPackageRow,
  mapRaceRow,
  type DbInventory,
  type DbPackage,
  type DbRace,
} from "@/lib/catalog/map-rows"

type HoldAgg = { qty: number; expiresAtMin: string }

async function fetchAgentHoldAggregates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentProfileId: string,
  packageIds?: string[],
): Promise<Map<string, HoldAgg>> {
  let query = supabase
    .from("inventory_holds")
    .select("package_id, quantity, expires_at")
    .eq("agent_profile_id", agentProfileId)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString())

  if (packageIds && packageIds.length > 0) {
    query = query.in("package_id", packageIds)
  }

  const { data, error } = await query

  if (error || !data?.length) return new Map()

  const m = new Map<string, HoldAgg>()
  for (const row of data as { package_id: string; quantity: number; expires_at: string }[]) {
    const prev = m.get(row.package_id)
    if (!prev) {
      m.set(row.package_id, { qty: row.quantity, expiresAtMin: row.expires_at })
    } else {
      const expiresAtMin =
        new Date(row.expires_at).getTime() < new Date(prev.expiresAtMin).getTime()
          ? row.expires_at
          : prev.expiresAtMin
      m.set(row.package_id, { qty: prev.qty + row.quantity, expiresAtMin })
    }
  }
  return m
}

function mergeAgentHoldAvailability(packages: Package[], holdAgg: Map<string, HoldAgg>): Package[] {
  return packages.map((p) => {
    const h = holdAgg.get(p.id)
    if (!h || typeof p.availability !== "number") return p
    return {
      ...p,
      availability: p.availability + h.qty,
      agentHoldUnits: h.qty,
      agentHoldExpiresAt: h.expiresAtMin,
    }
  })
}

async function fetchInventoryForPackages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageIds: string[],
): Promise<DbInventory[]> {
  if (packageIds.length === 0) return []
  const { data } = await supabase.from("package_inventory").select(INVENTORY_COLUMNS).in("package_id", packageIds)
  return (data ?? []) as DbInventory[]
}

function packageVisibleInPortal(dbPkg: DbPackage, raceSeason: number | null, bookableFrom: string): boolean {
  const season = raceSeason ?? seasonFromRaceId(dbPkg.race_id)
  if (season === 2027) return true
  return dbPkg.event_date >= bookableFrom
}

async function fetchFullCatalogBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ races: Race[]; packages: Package[] } | null> {
  const { data: allRaces, error: racesError } = await supabase.from("races").select(RACE_COLUMNS).order("event_date")
  const { data: allPackages, error: packagesError } = await supabase
    .from("packages")
    .select(PACKAGE_COLUMNS)
    .order("sort_order")
  const { data: inventory, error: invError } = await supabase.from("package_inventory").select(INVENTORY_COLUMNS)

  if (racesError || packagesError || invError) return null
  if (!allRaces || !allPackages) return null

  return buildCatalog(allRaces as DbRace[], allPackages as DbPackage[], (inventory ?? []) as DbInventory[])
}

export async function getPortalCatalog(agentProfileId?: string | null): Promise<PortalCatalog | null> {
  const supabase = await createClient()
  const base = await fetchFullCatalogBase(supabase)
  if (!base) return null

  let { races, packages } = base

  if (agentProfileId) {
    const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId)
    if (holdAgg.size > 0) {
      packages = mergeAgentHoldAvailability(packages, holdAgg)
    }
  }

  const seasons = buildPortalSeasonSlices(races, packages)
  return { seasons, defaultSeasonYear: DEFAULT_PORTAL_SEASON }
}

/** Flat list of all portal seasons (admin place-order, legacy callers). */
export async function getCatalog(agentProfileId?: string | null): Promise<{ races: Race[]; packages: Package[] } | null> {
  const portal = await getPortalCatalog(agentProfileId)
  if (!portal) return null
  const races = portal.seasons.flatMap((s) => s.races)
  const packages = portal.seasons.flatMap((s) => s.packages)
  return { races, packages }
}

/** One race and its packages only (for `/packages/race/[id]`). */
export async function getRaceCatalog(
  raceId: string,
  agentProfileId?: string | null,
): Promise<{ race: Race; packages: Package[] } | null> {
  const supabase = await createClient()

  const { data: raceRow, error: raceError } = await supabase
    .from("races")
    .select(RACE_COLUMNS)
    .eq("id", raceId)
    .maybeSingle()
  if (raceError || !raceRow) return null

  const dbRace = raceRow as DbRace
  const bookableFrom = bookableEventDateFrom()
  const season = dbRace.season ?? seasonFromRaceId(dbRace.id)
  if (season === 2026 && dbRace.event_date < bookableFrom) return null

  const { data: packageRows, error: pkgError } = await supabase
    .from("packages")
    .select(PACKAGE_COLUMNS)
    .eq("race_id", raceId)
    .order("sort_order")
  if (pkgError || !packageRows) return null

  const packageIds = (packageRows as DbPackage[]).map((p) => p.id)
  const inventoryRows = await fetchInventoryForPackages(supabase, packageIds)
  const invByPackage = new Map(inventoryRows.map((i) => [i.package_id, i]))

  let packages = (packageRows as DbPackage[]).map((p) => mapPackageRow(p, invByPackage.get(p.id)))
  const race = mapRaceRow(raceRow as DbRace, packages)

  if (agentProfileId && packages.length > 0) {
    const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId, packageIds)
    if (holdAgg.size > 0) {
      packages = mergeAgentHoldAvailability(packages, holdAgg)
    }
  }

  return { race, packages }
}

export async function getPackageById(id: string, agentProfileId?: string | null): Promise<Package | null> {
  const supabase = await createClient()

  const { data: p, error } = await supabase.from("packages").select(PACKAGE_COLUMNS).eq("id", id).maybeSingle()
  if (error || !p) return null

  const dbPkg = p as DbPackage
  const bookableFrom = bookableEventDateFrom()

  const { data: raceRow } = await supabase
    .from("races")
    .select("id, season, event_date")
    .eq("id", dbPkg.race_id)
    .maybeSingle()
  if (!raceRow) return null
  const raceSeason = (raceRow as DbRace).season ?? seasonFromRaceId(dbPkg.race_id)
  if (!packageVisibleInPortal(dbPkg, raceSeason, bookableFrom)) return null

  const { data: inv } = await supabase.from("package_inventory").select(INVENTORY_COLUMNS).eq("package_id", id).maybeSingle()
  let pkg = mapPackageRow(dbPkg, inv as DbInventory | undefined)

  if (agentProfileId && typeof pkg.availability === "number") {
    const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId, [id])
    const h = holdAgg.get(id)
    if (h) {
      pkg = {
        ...pkg,
        availability: pkg.availability + h.qty,
        agentHoldUnits: h.qty,
        agentHoldExpiresAt: h.expiresAtMin,
      }
    }
  }

  return pkg
}
