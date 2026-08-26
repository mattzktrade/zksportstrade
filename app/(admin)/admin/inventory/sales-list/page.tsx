import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminCatalogListRows } from "@/lib/admin/queries"
import { adminPackageSellable } from "@/lib/inventory/effective-availability"
import { getCrmAccountOptions } from "@/lib/crm/deals"
import { getSuppliers } from "@/lib/inventory/suppliers"
import {
  InventoryWorkspace,
  type InventoryAvailabilityPresentation,
} from "@/components/admin/inventory-workspace"

export const dynamic = "force-dynamic"

export default async function InventorySalesListPage() {
  await requireAdmin()
  const [rows, accountOptions, suppliers] = await Promise.all([
    getAdminCatalogListRows(),
    getCrmAccountOptions(),
    getSuppliers(),
  ])
  const nativeAvailability: Record<string, InventoryAvailabilityPresentation> = {}
  for (const row of rows) {
    nativeAvailability[row.id] = {
      sellable: adminPackageSellable(row),
      activeReservations: row.canonical_availability?.reserved ?? row.inventory?.qty_held ?? 0,
      openShortageQty: row.canonical_availability?.shortage ?? 0,
      bought: row.canonical_availability?.bought ?? row.layer_units_purchased ?? 0,
      committed: row.canonical_availability?.committed ?? row.sales_breakdown.total,
      historicalShortageQty: row.canonical_availability?.historicalShortage ?? 0,
      brokeredShortageQty: row.canonical_availability?.brokeredShortage ?? 0,
      canonical: Boolean(row.canonical_availability),
      isLegacyShell: Boolean(row.shell_parent_package_id),
    }
  }

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-4 lg:p-5">
      <InventoryWorkspace
        initialRows={rows.filter(
          (row) =>
            !row.is_hidden &&
            !row.shell_parent_package_id &&
            !nativeAvailability[row.id]?.isLegacyShell,
        )}
        mode="sales"
        nativeAvailability={nativeAvailability}
        accountOptions={accountOptions}
        supplierOptions={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
      />
    </div>
  )
}
