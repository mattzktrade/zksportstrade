import type { Package, Race } from "@/lib/data"
import { createClient } from "@/lib/supabase/server"
import { buildCatalog, mapPackageRow, type DbInventory, type DbPackage, type DbRace } from "@/lib/catalog/map-rows"

export async function getCatalog(): Promise<{ races: Race[]; packages: Package[] } | null> {
  const supabase = await createClient()
  const { data: races, error: racesError } = await supabase.from("races").select("*").order("event_date")
  const { data: packages, error: packagesError } = await supabase.from("packages").select("*").order("sort_order")
  const { data: inventory, error: invError } = await supabase.from("package_inventory").select("*")

  if (racesError || packagesError || invError) return null
  if (!races || !packages) return null

  return buildCatalog(races as DbRace[], packages as DbPackage[], (inventory ?? []) as DbInventory[])
}

export async function getPackageById(id: string): Promise<Package | null> {
  const supabase = await createClient()
  const { data: p, error } = await supabase.from("packages").select("*").eq("id", id).maybeSingle()
  if (error || !p) return null

  const { data: inv } = await supabase.from("package_inventory").select("*").eq("package_id", id).maybeSingle()
  return mapPackageRow(p as DbPackage, inv as DbInventory | undefined)
}
