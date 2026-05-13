import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageRows, getApprovedAgents, getInventoryHoldsWithDetails } from "@/lib/admin/queries"
import { InventoryAdminClient } from "./inventory-admin-client"

export default async function AdminInventoryPage() {
  await requireAdmin()
  const [holds, agents, pkgRows] = await Promise.all([
    getInventoryHoldsWithDetails(),
    getApprovedAgents(),
    getAdminPackageRows(),
  ])
  const packages = pkgRows.map((p) => ({ id: p.id, name: p.name }))

  return (
    <div className="p-6 lg:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Inventory & holds</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create client holds tied to agents, or release them when the allocation is no longer needed. Capacity edits live
          on the catalog page.
        </p>
      </div>
      <InventoryAdminClient holds={holds} agents={agents} packages={packages} />
    </div>
  )
}
