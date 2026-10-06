import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getFinanceWorkflowRows } from "@/lib/admin/workflow-views"
import { isFinanceStatusFilter } from "@/lib/admin/workflow-status"
import { WorkflowTrackerClient } from "@/components/admin/workflow-tracker-client"
import { AdminRouteShell } from "@/components/admin/admin-route-shell"

export const dynamic = "force-dynamic"

export default function FinanceDealsTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  return (
    <AdminRouteShell>
      <FinancePageBody searchParams={searchParams} />
    </AdminRouteShell>
  )
}

async function FinancePageBody({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const profile = await requireCmsPermission("finance.view")
  const { status } = await searchParams
  const rows = await getFinanceWorkflowRows()
  return (
    <WorkflowTrackerClient
      rows={rows}
      mode="finance"
      canManage={hasCmsPermission(profile, "finance.manage")}
      initialStatus={isFinanceStatusFilter(status) ? status : undefined}
    />
  )
}
