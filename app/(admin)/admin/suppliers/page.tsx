import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { SuppliersClient, type SupplierDirectoryRow } from "./suppliers-client"

export const dynamic = "force-dynamic"

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export default async function SuppliersPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [{ data: suppliers }, { data: purchaseOrders }, { data: layers }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, code, contact_name, contact_email, contact_phone, notes, active")
      .order("active", { ascending: false })
      .order("name"),
    supabase.from("purchase_orders").select("id, supplier_id"),
    supabase
      .from("package_cost_layers")
      // Dual FK to packages (package_id + source_package_id) requires this hint.
      .select("supplier_id, quantity, unit_cost, currency, packages!package_id(name)"),
  ])

  const poCount = new Map<string, number>()
  for (const po of purchaseOrders ?? []) {
    if (!po.supplier_id) continue
    poCount.set(po.supplier_id, (poCount.get(po.supplier_id) ?? 0) + 1)
  }

  const spend = new Map<string, number>()
  const currency = new Map<string, string>()
  const packages = new Map<string, Set<string>>()
  for (const layer of layers ?? []) {
    if (!layer.supplier_id) continue
    spend.set(
      layer.supplier_id,
      (spend.get(layer.supplier_id) ?? 0) + Number(layer.quantity ?? 0) * Number(layer.unit_cost ?? 0),
    )
    currency.set(layer.supplier_id, layer.currency || "USD")
    const pkg = one(layer.packages)
    if (pkg?.name) {
      const names = packages.get(layer.supplier_id) ?? new Set<string>()
      names.add(pkg.name)
      packages.set(layer.supplier_id, names)
    }
  }

  const rows: SupplierDirectoryRow[] = (suppliers ?? []).map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    code: supplier.code,
    contactName: supplier.contact_name,
    contactEmail: supplier.contact_email,
    contactPhone: supplier.contact_phone,
    notes: supplier.notes,
    active: supplier.active,
    purchaseOrders: poCount.get(supplier.id) ?? 0,
    packages: [...(packages.get(supplier.id) ?? new Set<string>())].sort(),
    spend: spend.get(supplier.id) ?? 0,
    currency: currency.get(supplier.id) ?? "USD",
  }))

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-4 lg:p-5">
      <SuppliersClient rows={rows} />
    </div>
  )
}
