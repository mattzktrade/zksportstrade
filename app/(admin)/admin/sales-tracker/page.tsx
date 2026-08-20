import { requireCmsPermission } from "@/lib/admin/require-admin"
import { getSalesTrackerRows } from "@/lib/admin/workflow-views"
import { SalesSourceTrackerClient } from "@/components/admin/sales-source-tracker-client"

export const dynamic = "force-dynamic"

export default async function SalesTrackerPage() {
  await requireCmsPermission("deals.view")
  const rows = await getSalesTrackerRows()
  return <SalesSourceTrackerClient rows={rows} />
}

