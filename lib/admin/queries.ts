import { createClient } from "@/lib/supabase/server"
import { isOutstandingInvoiceStatus } from "@/lib/invoices/status"
import type { PortalProfile } from "@/lib/types/profile"
import { INVENTORY_COLUMNS, PACKAGE_COLUMNS } from "@/lib/catalog/columns"
import type { DbInventory, DbPackage } from "@/lib/catalog/map-rows"
import { getCostLayersByPackage, summarizePackageCost, type CostLayerRow, type PackageCostSummary } from "@/lib/admin/cost-layers"

const AGENT_PROFILE_COLUMNS =
  "id, email, full_name, company_name, company_type, mobile, role, approval_status, created_at" as const
const PENDING_PROFILE_COLUMNS =
  "id, email, full_name, company_name, company_type, approval_status, created_at, approval_note" as const

export type AdminPackageRow = DbPackage & {
  inventory: DbInventory | null
  race_name: string
  cost_layers: CostLayerRow[]
  cost_summary: PackageCostSummary | null
}

export type AdminRaceOption = {
  id: string
  name: string
  short_name: string
  date_range: string
  event_date: string
  location: string
  country: string
  country_code: string
  season: number
}

export async function getAdminRaceOptions(): Promise<AdminRaceOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("races")
    .select("id,name,short_name,date_range,event_date,location,country,country_code,season")
    .order("season")
    .order("event_date")
  if (error || !data) return []
  return data as AdminRaceOption[]
}

export async function getPendingProfiles(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select(PENDING_PROFILE_COLUMNS)
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

export async function getApprovedAgents(): Promise<PortalProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select(AGENT_PROFILE_COLUMNS)
    .eq("role", "agent")
    .eq("approval_status", "approved")
    .order("company_name", { ascending: true })
  if (error || !data) return []
  return data as PortalProfile[]
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export type AdminAgentOrderRow = {
  orderId: string
  reference: string
  createdAt: string
  totalAmount: number
  currency: string
  packageId: string
  packageName: string
  circuit: string
  invoiceReference: string | null
  invoiceId: string | null
  invoiceStatus: string | null
}

export type AdminAgentWithStats = PortalProfile & {
  orderCount: number
  outstandingInvoiceCount: number
  /** Non-cancelled order totals by ISO currency code. */
  revenueByCurrency: Record<string, number>
  /** Short display for the table (e.g. one currency or multiple currencies joined). */
  revenueSummary: string
  /** Most recent orders for the expandable panel (capped per agent). */
  recentOrders: AdminAgentOrderRow[]
  /** All order references for admin search (not limited to recent cap). */
  orderSearchBlob: string
}

function formatRevenueSummary(by: Record<string, number>): string {
  const entries = Object.entries(by).filter(([, v]) => v > 0)
  if (entries.length === 0) return "—"
  const fmt = (currency: string, amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }
  if (entries.length === 1) {
    const [c, a] = entries[0]
    return fmt(c, a)
  }
  return entries.map(([c, a]) => fmt(c, a)).join(" · ")
}

type RawOrderForAgent = {
  id: string
  reference: string
  agent_profile_id: string
  package_id: string
  status: string
  guests: number
  total_amount: number
  currency: string
  created_at: string
  packages?: { name: string; circuit: string } | { name: string; circuit: string }[] | null
  invoices?:
    | { id: string; reference: string; status: string }
    | { id: string; reference: string; status: string }[]
    | null
}

/** Approved agents with live order / invoice aggregates for the admin Agents screen. */
export async function getAdminAgentsWithOrderStats(): Promise<AdminAgentWithStats[]> {
  const agents = await getApprovedAgents()
  if (agents.length === 0) return []

  const supabase = await createClient()
  const ids = agents.map((a) => a.id)
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      reference,
      agent_profile_id,
      package_id,
      status,
      total_amount,
      currency,
      created_at,
      packages ( name, circuit ),
      invoices ( id, reference, status )
    `,
    )
    .in("agent_profile_id", ids)
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error || !data) {
    return agents.map((a) => ({
      ...a,
      orderCount: 0,
      outstandingInvoiceCount: 0,
      revenueByCurrency: {},
      revenueSummary: "—",
      recentOrders: [],
      orderSearchBlob: "",
    }))
  }

  const rows = data as RawOrderForAgent[]
  const byAgent = new Map<string, RawOrderForAgent[]>()
  for (const r of rows) {
    const list = byAgent.get(r.agent_profile_id) ?? []
    list.push(r)
    byAgent.set(r.agent_profile_id, list)
  }

  const RECENT_CAP = 40

  return agents.map((agent) => {
    const list = byAgent.get(agent.id) ?? []
    let outstandingInvoiceCount = 0
    const revenueByCurrency: Record<string, number> = {}

    for (const r of list) {
      const inv = one(r.invoices)
      if (inv && isOutstandingInvoiceStatus(inv.status)) {
        outstandingInvoiceCount += 1
      }
      if (r.status !== "cancelled") {
        const cur = (r.currency ?? "USD").trim() || "USD"
        revenueByCurrency[cur] = (revenueByCurrency[cur] ?? 0) + Number(r.total_amount)
      }
    }

    const recentOrders: AdminAgentOrderRow[] = list.slice(0, RECENT_CAP).map((r) => {
      const pkg = one(r.packages)
      const inv = one(r.invoices)
      return {
        orderId: r.id,
        reference: r.reference,
        createdAt: r.created_at,
        totalAmount: Number(r.total_amount),
        currency: (r.currency ?? "USD").trim() || "USD",
        packageId: r.package_id,
        packageName: pkg?.name ?? "—",
        circuit: pkg?.circuit ?? "—",
        invoiceReference: inv?.reference ?? null,
        invoiceId: inv?.id ?? null,
        invoiceStatus: inv?.status ?? null,
      }
    })

    const orderSearchBlob = list
      .map((r) => {
        const pkg = one(r.packages)
        return [r.reference, pkg?.name ?? ""].filter(Boolean).join(" ")
      })
      .join(" ")

    return {
      ...agent,
      orderCount: list.length,
      outstandingInvoiceCount,
      revenueByCurrency,
      revenueSummary: formatRevenueSummary(revenueByCurrency),
      recentOrders,
      orderSearchBlob,
    }
  })
}

export async function getAdminPackageById(packageId: string): Promise<AdminPackageRow | null> {
  const rows = await getAdminPackageRows()
  return rows.find((p) => p.id === packageId) ?? null
}

export async function getAdminPackageRows(): Promise<AdminPackageRow[]> {
  const supabase = await createClient()
  const [{ data: races, error: re }, { data: packages, error: pe }, { data: inv, error: ie }] = await Promise.all([
    supabase.from("races").select("id,name").order("event_date"),
    supabase.from("packages").select(PACKAGE_COLUMNS).order("sort_order"),
    supabase.from("package_inventory").select(INVENTORY_COLUMNS),
  ])
  if (re || pe || ie || !packages) return []
  const raceName = new Map((races ?? []).map((r: { id: string; name: string }) => [r.id, r.name]))
  const invBy = new Map((inv ?? []).map((i: DbInventory) => [i.package_id, i]))
  const packageIds = (packages as DbPackage[]).map((p) => p.id)
  const layersByPkg = await getCostLayersByPackage(packageIds)
  return (packages as DbPackage[]).map((p) => {
    const layers = layersByPkg.get(p.id) ?? []
    const summary = summarizePackageCost(p.currency || "USD", layers)
    if (summary) summary.package_id = p.id
    return {
      ...p,
      inventory: invBy.get(p.id) ?? null,
      race_name: raceName.get(p.race_id) ?? p.race_id,
      cost_layers: layers,
      cost_summary: summary,
    }
  })
}

export type InventoryHoldRow = {
  id: string
  package_id: string
  agent_profile_id: string
  quantity: number
  note: string | null
  created_at: string
  released_at: string | null
  expires_at: string
}

/** Packages that have an inventory row (required for holds). */
export type InventoryPackageOption = {
  id: string
  name: string
  race_name: string
  circuit: string
  date_range: string
  location: string
  qty_available: number
  qty_held: number
}

export type InventoryHoldWithDetails = InventoryHoldRow & {
  package_name: string
  /** Race / dates / circuit so holds line up with the right event. */
  package_event_summary: string
  agent_email: string
  agent_company: string
}

function packageEventSummary(
  raceName: string,
  p: { date_range: string; circuit: string; location: string },
): string {
  const bits = [raceName]
  const dr = p.date_range?.trim()
  const circ = p.circuit?.trim()
  const loc = p.location?.trim()
  if (dr) bits.push(dr)
  if (circ) bits.push(circ)
  else if (loc) bits.push(loc)
  return bits.join(" · ")
}

export async function getInventoryHoldsWithDetails(): Promise<InventoryHoldWithDetails[]> {
  const supabase = await createClient()
  const { data: holds, error } = await supabase
    .from("inventory_holds")
    .select("id, package_id, agent_profile_id, quantity, note, created_at, released_at, expires_at")
    .order("created_at", { ascending: false })
  if (error || !holds?.length) return []

  const packageIds = [...new Set(holds.map((h) => h.package_id))]
  const agentIds = [...new Set(holds.map((h) => h.agent_profile_id))]

  const [{ data: pkgs }, { data: profs }] = await Promise.all([
    supabase.from("packages").select("id,name,circuit,date_range,race_id,location").in("id", packageIds),
    supabase.from("profiles").select("id,email,company_name").in("id", agentIds),
  ])

  const raceIds = [...new Set((pkgs ?? []).map((p: { race_id: string }) => p.race_id))]
  const { data: races } = await supabase.from("races").select("id,name").in("id", raceIds)
  const raceName = new Map((races ?? []).map((r: { id: string; name: string }) => [r.id, r.name]))

  const pkgById = new Map(
    (pkgs ?? []).map((p: { id: string; name: string; circuit: string; date_range: string; race_id: string; location: string }) => [
      p.id,
      p,
    ]),
  )
  const profBy = new Map(
    (profs ?? []).map((p: { id: string; email: string; company_name: string }) => [
      p.id,
      { email: p.email, company_name: p.company_name },
    ]),
  )

  return holds.map((h) => {
    const agent = profBy.get(h.agent_profile_id)
    const pkg = pkgById.get(h.package_id)
    const rn = pkg ? raceName.get(pkg.race_id) ?? pkg.race_id : ""
    return {
      ...(h as InventoryHoldRow),
      package_name: pkg?.name ?? h.package_id,
      package_event_summary: pkg ? packageEventSummary(rn, pkg) : "",
      agent_email: agent?.email ?? "",
      agent_company: agent?.company_name ?? "",
    }
  })
}
