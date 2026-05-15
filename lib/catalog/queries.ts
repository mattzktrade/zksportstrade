import type { Package, Race } from "@/lib/types/catalog"
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

export async function getCatalog(agentProfileId?: string | null): Promise<{ races: Race[]; packages: Package[] } | null> {
  const supabase = await createClient()

  const { data: races, error: racesError } = await supabase.from("races").select(RACE_COLUMNS).order("event_date")
  const { data: packages, error: packagesError } = await supabase.from("packages").select(PACKAGE_COLUMNS).order("sort_order")
  const { data: inventory, error: invError } = await supabase.from("package_inventory").select(INVENTORY_COLUMNS)

  if (racesError || packagesError || invError) return null
  if (!races || !packages) return null

  const base = buildCatalog(races as DbRace[], packages as DbPackage[], (inventory ?? []) as DbInventory[])

  if (!agentProfileId) return base

  const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId)
  if (holdAgg.size === 0) return base

  const mergedPackages = mergeAgentHoldAvailability(base.packages, holdAgg)
  return { races: base.races, packages: mergedPackages }
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

  const { data: inv } = await supabase.from("package_inventory").select(INVENTORY_COLUMNS).eq("package_id", id).maybeSingle()
  let pkg = mapPackageRow(p as DbPackage, inv as DbInventory | undefined)

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
