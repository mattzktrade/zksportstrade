import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getFinanceWorkflowRows } from "@/lib/admin/workflow-views"
import { isFinanceStatusFilter } from "@/lib/admin/workflow-status"
import { WorkflowTrackerClient } from "@/components/admin/workflow-tracker-client"

export const dynamic = "force-dynamic"

export default async function FinanceDealsTrackerPage({
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
