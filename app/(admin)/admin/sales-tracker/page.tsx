import { requireCmsPermission } from "@/lib/admin/require-admin"
import { getSalesTrackerRows } from "@/lib/admin/workflow-views"
import { getDemandPlanningLines } from "@/lib/crm/demand-planning-queries"
import { SalesSourceTrackerClient } from "@/components/admin/sales-source-tracker-client"
import { DemandPlanningClient } from "@/components/admin/demand-planning-client"
import { AdminRouteShell } from "@/components/admin/admin-route-shell"

export const dynamic = "force-dynamic"

export default function SalesTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  return (
    <AdminRouteShell>
      <SalesTrackerPageBody searchParams={searchParams} />
    </AdminRouteShell>
  )
}

async function SalesTrackerPageBody({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  await requireCmsPermission("deals.view")
  const { view } = await searchParams
  const tab = view === "demand" ? "demand" : "revenue"

  if (tab === "demand") {
    const lines = await getDemandPlanningLines()
    return <DemandPlanningClient lines={lines} />
  }

  const rows = await getSalesTrackerRows()
  return <SalesSourceTrackerClient rows={rows} />
}
