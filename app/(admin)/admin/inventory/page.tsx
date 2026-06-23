import dynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { releaseExpiredInventoryHoldsAndSync } from "@/lib/integrations/release-expired-holds"
import {
  getAdminPackageRows,
  getApprovedAgents,
  getInventoryHoldsWithDetails,
  type InventoryPackageOption,
} from "@/lib/admin/queries"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

const InventoryAdminClient = dynamic(
  () => import("./inventory-admin-client").then((m) => ({ default: m.InventoryAdminClient })),
  { loading: () => <PageLoadingSpinner /> },
)

function toInventoryOptions(pkgRows: Awaited<ReturnType<typeof getAdminPackageRows>>): InventoryPackageOption[] {
  return pkgRows
    .filter((p) => p.inventory != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      race_name: p.race_name,
      circuit: p.circuit,
      date_range: p.date_range,
      location: p.location,
      qty_available: p.inventory!.qty_available,
      qty_held: p.inventory!.qty_held,
    }))
    .sort((a, b) => a.race_name.localeCompare(b.race_name) || a.name.localeCompare(b.name))
}

export default async function AdminInventoryPage() {
  await requireAdmin()
  try {
    await releaseExpiredInventoryHoldsAndSync()
  } catch (e) {
    console.error("[admin/inventory] expired hold release failed:", e)
  }
  const [holds, agents, pkgRows] = await Promise.all([
    getInventoryHoldsWithDetails(),
    getApprovedAgents(),
    getAdminPackageRows(),
  ])
  const packages = toInventoryOptions(pkgRows)

  return (
    <div className="p-6 lg:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Holds</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reserve stock for a trade partner. Holds auto-release after the duration you set.
        </p>
      </div>
      <InventoryAdminClient holds={holds} agents={agents} packages={packages} />
    </div>
  )
}
