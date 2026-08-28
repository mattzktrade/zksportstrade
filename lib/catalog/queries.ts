import type { Package, Race } from "@/lib/types/catalog"
import { bookableEventDateFrom } from "@/lib/catalog/bookable-events"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"
import { pickFeaturedPackages, FEATURED_PACKAGE_IDS } from "@/lib/catalog/featured-packages"
import {
  buildPortalSeasonSlices,
  DEFAULT_PORTAL_SEASON,
  type PortalCatalog,
} from "@/lib/catalog/portal-catalog"
import { INVENTORY_COLUMNS, PACKAGE_COLUMNS, PORTAL_HOME_PACKAGE_COLUMNS, RACE_COLUMNS } from "@/lib/catalog/columns"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildCatalog,
  mapPackageRow,
  mapRaceRow,
  type DbInventory,
  type DbPackage,
  type DbRace,
} from "@/lib/catalog/map-rows"
import { attachLargestSameSuiteRemaining } from "@/lib/catalog/same-suite-remaining"
import { attachStorefrontAvailability } from "@/lib/catalog/storefront-availability"
import { getPortalProfile } from "@/lib/supabase/profile"

export type PortalCatalogSellable = "all" | "featured" | "none"

type PackageMeta = {
  id: string
  inventory_group_id?: string | null
  duration?: string | null
  shell_parent_package_id?: string | null
}

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

function catalogReadClient(fallback: Awaited<ReturnType<typeof createClient>>) {
  return (createAdminClient() ?? fallback) as Awaited<ReturnType<typeof createClient>>
}

function isPortalVisiblePackage(pkg: DbPackage): boolean {
  return !pkg.is_hidden && pkg.sell_on_trade_portal !== false && !pkg.shell_parent_package_id
}

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

type PackageColumnSet = typeof PACKAGE_COLUMNS | typeof PORTAL_HOME_PACKAGE_COLUMNS

async function fetchCatalogBuilt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options?: { includeInventory?: boolean; packageColumns?: PackageColumnSet },
): Promise<{ races: Race[]; packages: Package[]; packageMeta: PackageMeta[] } | null> {
  const includeInventory = options?.includeInventory !== false
  const packagesQuery =
    options?.packageColumns === PORTAL_HOME_PACKAGE_COLUMNS
      ? supabase.from("packages").select(PORTAL_HOME_PACKAGE_COLUMNS).order("sort_order")
      : supabase.from("packages").select(PACKAGE_COLUMNS).order("sort_order")
  const [racesRes, packagesRes, inventoryRes] = await Promise.all([
    supabase.from("races").select(RACE_COLUMNS).order("event_date"),
    packagesQuery,
    includeInventory
      ? supabase.from("package_inventory").select(INVENTORY_COLUMNS)
      : Promise.resolve({ data: [] as DbInventory[], error: null }),
  ])
  const allRaces = racesRes.data
  const racesError = racesRes.error
  const allPackages = packagesRes.data
  const packagesError = packagesRes.error
  const inventory = inventoryRes.data
  const invError = inventoryRes.error

  if (racesError || packagesError) {
    console.warn("[portal] catalog query failed:", racesError?.message ?? packagesError?.message)
    return null
  }
  if (!allRaces || !allPackages) return null
  if (invError) {
    console.warn(
      "[portal] package_inventory unavailable; showing catalog without stock counts:",
      invError.message,
    )
  }

  const visiblePackageRows = asRows<DbPackage>(allPackages).filter(isPortalVisiblePackage)
  const built = buildCatalog(asRows<DbRace>(allRaces), visiblePackageRows, asRows<DbInventory>(inventory))
  const packageMeta = visiblePackageRows.map((p) => ({
    id: p.id,
    inventory_group_id: p.inventory_group_id,
    duration: p.duration,
    shell_parent_package_id: p.shell_parent_package_id,
  }))
  return { races: built.races, packages: built.packages, packageMeta }
}

async function fetchHomeCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ races: Race[]; packages: Package[]; packageMeta: PackageMeta[] } | null> {
  const featuredOr = `featured.eq.true,id.in.(${FEATURED_PACKAGE_IDS.join(",")})`
  const [racesRes, packagesRes] = await Promise.all([
    supabase.from("races").select(RACE_COLUMNS).order("event_date"),
    supabase.from("packages").select(PORTAL_HOME_PACKAGE_COLUMNS).or(featuredOr),
  ])
  if (racesRes.error || packagesRes.error) {
    console.warn("[portal] home catalog query failed:", racesRes.error?.message ?? packagesRes.error?.message)
    return null
  }
  if (!racesRes.data || !packagesRes.data) return null

  const visiblePackageRows = asRows<DbPackage>(packagesRes.data).filter(isPortalVisiblePackage)
  const built = buildCatalog(asRows<DbRace>(racesRes.data), visiblePackageRows, [])
  const packageMeta = visiblePackageRows.map((p) => ({
    id: p.id,
    inventory_group_id: p.inventory_group_id,
    duration: p.duration,
    shell_parent_package_id: p.shell_parent_package_id,
  }))
  return { races: built.races, packages: built.packages, packageMeta }
}

async function resolveAgentId(explicit?: string | null): Promise<string | null> {
  if (explicit !== undefined) return explicit
  const profile = await getPortalProfile()
  return profile?.id ?? null
}

async function attachPortalSellable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packages: Package[],
  packageMeta: PackageMeta[],
  agentProfileId?: string | null,
  holdPackageIds?: string[],
): Promise<Package[]> {
  if (packages.length === 0) return packages
  const sellablePromise = attachStorefrontAvailability(supabase, packages, packageMeta).then((rows) =>
    attachLargestSameSuiteRemaining(supabase, rows, packageMeta),
  )
  if (!agentProfileId) return sellablePromise

  const [next, holdAgg] = await Promise.all([
    sellablePromise,
    fetchAgentHoldAggregates(supabase, agentProfileId, holdPackageIds),
  ])
  if (holdAgg.size === 0) return next
  return mergeAgentHoldAvailability(next, holdAgg)
}

export async function getPortalCatalog(
  agentProfileId?: string | null,
  options?: { sellable?: PortalCatalogSellable },
): Promise<PortalCatalog | null> {
  const userClient = await createClient()
  const supabase = catalogReadClient(userClient)
  const sellable = options?.sellable ?? "all"

  if (sellable === "featured") {
    const [base, agentId] = await Promise.all([
      fetchHomeCatalog(supabase),
      resolveAgentId(agentProfileId),
    ])
    if (!base) return null
    const seasons = buildPortalSeasonSlices(base.races, base.packages)
    const featuredIds = new Set(
      seasons.flatMap((slice) => pickFeaturedPackages(slice.packages).map((pkg) => pkg.id)),
    )
    const featuredPackages = base.packages.filter((pkg) => featuredIds.has(pkg.id))
    const featuredMeta = base.packageMeta.filter((row) => featuredIds.has(row.id))
    const withAvail = await attachPortalSellable(
      supabase,
      featuredPackages,
      featuredMeta,
      agentId,
      [...featuredIds],
    )
    const byId = new Map(withAvail.map((pkg) => [pkg.id, pkg]))
    return {
      seasons: seasons.map((slice) => ({
        ...slice,
        packages: pickFeaturedPackages(slice.packages).map((pkg) => byId.get(pkg.id) ?? pkg),
      })),
      defaultSeasonYear: DEFAULT_PORTAL_SEASON,
    }
  }

  const base = await fetchCatalogBuilt(supabase, {
    includeInventory: sellable === "all",
    packageColumns: sellable === "none" ? PORTAL_HOME_PACKAGE_COLUMNS : PACKAGE_COLUMNS,
  })
  if (!base) return null

  if (sellable === "none") {
    return {
      seasons: buildPortalSeasonSlices(base.races, base.packages),
      defaultSeasonYear: DEFAULT_PORTAL_SEASON,
    }
  }

  const packages = await attachPortalSellable(supabase, base.packages, base.packageMeta, agentProfileId)
  return {
    seasons: buildPortalSeasonSlices(base.races, packages),
    defaultSeasonYear: DEFAULT_PORTAL_SEASON,
  }
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
  const supabase = catalogReadClient(await createClient())

  const [{ data: raceRow, error: raceError }, { data: packageRows, error: pkgError }] = await Promise.all([
    supabase.from("races").select(RACE_COLUMNS).eq("id", raceId).maybeSingle(),
    supabase.from("packages").select(PACKAGE_COLUMNS).eq("race_id", raceId).order("sort_order"),
  ])
  if (raceError || !raceRow) return null

  const dbRace = raceRow as DbRace
  const bookableFrom = bookableEventDateFrom()
  const season = dbRace.season ?? seasonFromRaceId(dbRace.id)
  if (season === 2026 && dbRace.event_date < bookableFrom) return null

  if (pkgError || !packageRows) return null

  const visiblePackageRows = asRows<DbPackage>(packageRows).filter(
    (pkg) =>
      !pkg.is_hidden &&
      pkg.sell_on_trade_portal !== false &&
      !pkg.shell_parent_package_id,
  )
  const packageIds = visiblePackageRows.map((p) => p.id)
  const inventoryRows = await fetchInventoryForPackages(supabase, packageIds)
  const invByPackage = new Map(inventoryRows.map((i) => [i.package_id, i]))

  const packageMeta = visiblePackageRows.map((p) => ({
    id: p.id,
    inventory_group_id: p.inventory_group_id,
    duration: p.duration,
    shell_parent_package_id: p.shell_parent_package_id,
  }))
  let packages = visiblePackageRows.map((p) => mapPackageRow(p, invByPackage.get(p.id)))
  packages = await attachStorefrontAvailability(supabase, packages, packageMeta)
  packages = await attachLargestSameSuiteRemaining(supabase, packages, packageMeta)
  const race = mapRaceRow(raceRow as DbRace, packages)

  if (agentProfileId && packages.length > 0) {
    const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId, packageIds)
    if (holdAgg.size > 0) {
      packages = mergeAgentHoldAvailability(packages, holdAgg)
    }
  }

  return { race, packages }
}

export async function getPackageById(
  id: string,
  agentProfileId?: string | null,
  options?: { includeUnlisted?: boolean },
): Promise<Package | null> {
  const supabase = await createClient()

  const { data: p, error } = await supabase.from("packages").select(PACKAGE_COLUMNS).eq("id", id).maybeSingle()
  if (error || !p) return null

  const dbPkg = p as DbPackage
  if (
    !options?.includeUnlisted &&
    (dbPkg.is_hidden || dbPkg.sell_on_trade_portal === false || Boolean(dbPkg.shell_parent_package_id))
  ) return null
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
  const packageMeta = [
    {
      id: dbPkg.id,
      inventory_group_id: dbPkg.inventory_group_id,
      duration: dbPkg.duration,
      shell_parent_package_id: dbPkg.shell_parent_package_id,
    },
  ]
  ;[pkg] = await attachStorefrontAvailability(supabase, [pkg], packageMeta)
  ;[pkg] = await attachLargestSameSuiteRemaining(supabase, [pkg], packageMeta)

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
