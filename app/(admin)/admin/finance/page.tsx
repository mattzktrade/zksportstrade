import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getFinanceWorkflowRows } from "@/lib/admin/workflow-views"
import { WorkflowTrackerClient } from "@/components/admin/workflow-tracker-client"

export const dynamic = "force-dynamic"

export default async function FinanceDealsTrackerPage() {
  const profile = await requireCmsPermission("finance.view")
  const rows = await getFinanceWorkflowRows()
  return (
    <WorkflowTrackerClient
      rows={rows}
      mode="finance"
      canManage={hasCmsPermission(profile, "finance.manage")}
    />
  )
}
