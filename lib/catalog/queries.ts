import type { Package, Race } from "@/lib/data"
import { createClient } from "@/lib/supabase/server"
import { buildCatalog, mapPackageRow, type DbInventory, type DbPackage, type DbRace } from "@/lib/catalog/map-rows"

type HoldAgg = { qty: number; expiresAtMin: string }

async function fetchAgentHoldAggregates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentProfileId: string,
): Promise<Map<string, HoldAgg>> {
  const { data, error } = await supabase
    .from("inventory_holds")
    .select("package_id, quantity, expires_at")
    .eq("agent_profile_id", agentProfileId)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString())

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

export async function getCatalog(agentProfileId?: string | null): Promise<{ races: Race[]; packages: Package[] } | null> {
  const supabase = await createClient()

  const { data: races, error: racesError } = await supabase.from("races").select("*").order("event_date")
  const { data: packages, error: packagesError } = await supabase.from("packages").select("*").order("sort_order")
  const { data: inventory, error: invError } = await supabase.from("package_inventory").select("*")

  if (racesError || packagesError || invError) return null
  if (!races || !packages) return null

  const base = buildCatalog(races as DbRace[], packages as DbPackage[], (inventory ?? []) as DbInventory[])

  if (!agentProfileId) return base

  const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId)
  if (holdAgg.size === 0) return base

  const mergedPackages = mergeAgentHoldAvailability(base.packages, holdAgg)
  return { races: base.races, packages: mergedPackages }
}

export async function getPackageById(id: string, agentProfileId?: string | null): Promise<Package | null> {
  const supabase = await createClient()

  const { data: p, error } = await supabase.from("packages").select("*").eq("id", id).maybeSingle()
  if (error || !p) return null

  const { data: inv } = await supabase.from("package_inventory").select("*").eq("package_id", id).maybeSingle()
  let pkg = mapPackageRow(p as DbPackage, inv as DbInventory | undefined)

  if (agentProfileId && typeof pkg.availability === "number") {
    const holdAgg = await fetchAgentHoldAggregates(supabase, agentProfileId)
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
