import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminCatalogListRows } from "@/lib/admin/queries"
import { getNativePackageAvailability } from "@/lib/inventory/ledger"
import { getCrmAccountOptions } from "@/lib/crm/deals"
import { getSuppliers } from "@/lib/inventory/suppliers"
import {
  InventoryWorkspace,
  type InventoryAvailabilityPresentation,
} from "@/components/admin/inventory-workspace"

export const dynamic = "force-dynamic"

export default async function InventorySalesListPage() {
  await requireAdmin()
  const [rows, availabilityRows, accountOptions, suppliers] = await Promise.all([
    getAdminCatalogListRows(),
    getNativePackageAvailability(),
    getCrmAccountOptions(),
    getSuppliers(),
  ])
  const nativeAvailability: Record<string, InventoryAvailabilityPresentation> = {}
  for (const row of availabilityRows) {
    nativeAvailability[row.package_id] = {
      // Deal reservation RPCs also increment package_inventory.qty_held, so the
      // compatibility sellable figure already includes them. Do not subtract twice.
      sellable: Math.max(0, row.legacy_sellable),
      activeReservations: row.active_reservations,
      openShortageQty: row.open_shortage_qty,
      isLegacyShell: row.is_legacy_shell,
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
