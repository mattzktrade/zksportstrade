import { createClient } from "@/lib/supabase/server"
import type { PortalProfile } from "@/lib/types/profile"
import type { DbInventory, DbPackage, DbRace } from "@/lib/catalog/map-rows"

export type AdminPackageRow = DbPackage & { inventory: DbInventory | null; race_name: string }

export async function getPendingProfiles(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

export async function getApprovedAgents(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "agent")
    .eq("approval_status", "approved")
    .order("company_name", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

export async function getAdminPackageRows(): Promise<AdminPackageRow[]> {
  const supabase = await createClient()
  const [{ data: races, error: re }, { data: packages, error: pe }, { data: inv, error: ie }] = await Promise.all([
    supabase.from("races").select("id,name").order("event_date"),
    supabase.from("packages").select("*").order("sort_order"),
    supabase.from("package_inventory").select("*"),
  ])
  if (re || pe || ie || !packages) return []
  const raceName = new Map((races ?? []).map((r: { id: string; name: string }) => [r.id, r.name]))
  const invBy = new Map((inv ?? []).map((i: DbInventory) => [i.package_id, i]))
  return packages.map((p: DbPackage) => ({
    ...p,
    inventory: invBy.get(p.id) ?? null,
    race_name: raceName.get(p.race_id) ?? p.race_id,
  }))
}

export type InventoryHoldRow = {
  id: string
  package_id: string
  agent_profile_id: string
  quantity: number
  note: string | null
  created_at: string
  released_at: string | null
}

export async function getInventoryHoldsWithDetails(): Promise<
  (InventoryHoldRow & { package_name: string; agent_email: string; agent_company: string })[]
> {
  const supabase = await createClient()
  const { data: holds, error } = await supabase
    .from("inventory_holds")
    .select("id, package_id, agent_profile_id, quantity, note, created_at, released_at")
    .order("created_at", { ascending: false })
  if (error || !holds?.length) return []

  const packageIds = [...new Set(holds.map((h) => h.package_id))]
  const agentIds = [...new Set(holds.map((h) => h.agent_profile_id))]

  const [{ data: pkgs }, { data: profs }] = await Promise.all([
    supabase.from("packages").select("id,name").in("id", packageIds),
    supabase.from("profiles").select("id,email,company_name").in("id", agentIds),
  ])
  const pkgName = new Map((pkgs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const profBy = new Map(
    (profs ?? []).map((p: { id: string; email: string; company_name: string }) => [
      p.id,
      { email: p.email, company_name: p.company_name },
    ]),
  )

  return holds.map((h) => {
    const agent = profBy.get(h.agent_profile_id)
    return {
      ...(h as InventoryHoldRow),
      package_name: pkgName.get(h.package_id) ?? h.package_id,
      agent_email: agent?.email ?? "",
      agent_company: agent?.company_name ?? "",
    }
  })
}
