import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getPortalProfile } from "@/lib/supabase/profile"
import {
  getOperationsSupportingData,
  getOperationsWorkflowRows,
} from "@/lib/admin/workflow-views"
import { OperationsClient } from "./operations-client"

export const dynamic = "force-dynamic"

export default async function OperationsPage() {
  await requireCmsPermission("operations.view")
  const [profile, rows, supporting] = await Promise.all([
    getPortalProfile(),
    getOperationsWorkflowRows(),
    getOperationsSupportingData(),
  ])
  return (
    <OperationsClient
      initialRows={rows}
      supporting={supporting}
      canManage={hasCmsPermission(profile, "operations.manage")}
    />
  )
}

