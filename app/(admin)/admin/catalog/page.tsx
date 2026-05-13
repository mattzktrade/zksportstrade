import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageRows } from "@/lib/admin/queries"
import { CatalogAdminTable, type CatalogAdminRow } from "./catalog-admin-table"

export default async function AdminCatalogPage() {
  await requireAdmin()
  const rows = await getAdminPackageRows()
  const mapped: CatalogAdminRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    race_name: r.race_name,
    trade_price: r.trade_price != null ? Number(r.trade_price) : null,
    is_enquiry: r.is_enquiry,
    featured: r.featured,
    sort_order: r.sort_order,
    inventory: r.inventory
      ? { qty_available: r.inventory.qty_available, qty_held: r.inventory.qty_held }
      : null,
  }))

  return (
    <div className="p-6 lg:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Catalog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Adjust trade pricing, enquiry flags, and inventory ceilings. Race records are seeded; contact engineering to add
          new races in Supabase if needed.
        </p>
      </div>
      <CatalogAdminTable rows={mapped} />
    </div>
  )
}
