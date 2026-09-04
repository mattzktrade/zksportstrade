import { requireAdmin } from "@/lib/admin/require-admin"
import {
  buildSupplierDirectoryRows,
  type SupplierDirectoryLayer,
  type SupplierDirectoryRace,
} from "@/lib/admin/supplier-directory"
import { createClient } from "@/lib/supabase/server"
import { chunkList, fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { SuppliersClient } from "./suppliers-client"

export const dynamic = "force-dynamic"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type LayerRow = {
  id: string
  supplier_id: string | null
  quantity: number | string
  unit_cost: number | string
  currency: string
  packages:
    | { name: string; race_id: string | null }
    | Array<{ name: string; race_id: string | null }>
    | null
}

export default async function SuppliersPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [suppliersRes, purchaseOrdersRes, layersRes, coverageRes, racesRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("suppliers")
        .select("id, name, code, contact_name, contact_email, contact_phone, notes, active, crm_account_id")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase.from("purchase_orders").select("id, supplier_id").order("id").range(from, to),
    ),
    fetchAllRows<LayerRow>((from, to) =>
      supabase
        .from("package_cost_layers")
        .select("id, supplier_id, quantity, unit_cost, currency, packages!package_id(name, race_id)")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("supplier_event_coverage")
        .select("supplier_id, race_id")
        .order("supplier_id", { ascending: true })
        .order("race_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("races")
        .select("id, name, short_name, season, event_date, category, country, location")
        .order("id")
        .range(from, to),
    ),
  ])

  const loadError = [suppliersRes, purchaseOrdersRes, layersRes, coverageRes, racesRes]
    .map((result) => result.error?.message)
    .filter(Boolean)
    .join("; ")
  if (loadError) throw new Error(loadError)

  const suppliers = suppliersRes.data ?? []
  const accountIds = [
    ...new Set(suppliers.map((supplier) => supplier.crm_account_id).filter((id): id is string => Boolean(id))),
  ]
  const accountKindsById = new Map<string, unknown>()
  for (const chunk of chunkList(accountIds, 200)) {
    if (chunk.length === 0) continue
    const { data: accounts } = await supabase.from("crm_accounts").select("id, account_types").in("id", chunk)
    for (const account of accounts ?? []) accountKindsById.set(account.id, account.account_types)
  }

  const poCount = new Map<string, number>()
  for (const po of purchaseOrdersRes.data ?? []) {
    if (!po.supplier_id) continue
    poCount.set(po.supplier_id, (poCount.get(po.supplier_id) ?? 0) + 1)
  }

  const layers: SupplierDirectoryLayer[] = (layersRes.data ?? []).map((layer) => {
    const pkg = one(layer.packages)
    return {
      supplierId: layer.supplier_id,
      quantity: Number(layer.quantity ?? 0),
      unitCost: Number(layer.unit_cost ?? 0),
      currency: layer.currency || "USD",
      packageName: pkg?.name ?? null,
      raceId: pkg?.race_id ?? null,
    }
  })

  const races: SupplierDirectoryRace[] = (racesRes.data ?? []).map((race) => ({
    id: race.id,
    name: race.name,
    shortName: race.short_name,
    season: race.season,
    eventDate: race.event_date,
    category: String(race.category ?? ""),
    country: race.country,
    location: race.location,
  }))

  const rows = buildSupplierDirectoryRows({
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      contactName: supplier.contact_name,
      contactEmail: supplier.contact_email,
      contactPhone: supplier.contact_phone,
      notes: supplier.notes,
      active: Boolean(supplier.active),
      accountKinds: supplier.crm_account_id ? accountKindsById.get(supplier.crm_account_id) ?? [] : [],
    })),
    purchaseOrderCounts: poCount,
    layers,
    coverage: (coverageRes.data ?? []).map((row) => ({
      supplierId: String(row.supplier_id),
      raceId: String(row.race_id),
    })),
    races,
  })

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-4 lg:p-5">
      <SuppliersClient rows={rows} />
    </div>
  )
}
