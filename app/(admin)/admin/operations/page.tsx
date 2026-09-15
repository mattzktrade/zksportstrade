import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getPortalProfile } from "@/lib/supabase/profile"
import {
  getOperationsSupportingData,
  getOperationsWorkflowRows,
} from "@/lib/admin/workflow-views"
import {
  loadOperationsAccountContacts,
  loadOperationsDeliveryProofs,
} from "@/lib/admin/operations-bookings"
import { loadOperationsEmailTemplates } from "@/app/(admin)/admin/operations/template-actions"
import { loadOperationsCalendarEntries } from "@/app/(admin)/admin/operations/calendar-actions"
import { OperationsClient } from "./operations-client"

export const dynamic = "force-dynamic"

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; booking?: string; deal?: string }>
}) {
  await requireCmsPermission("operations.view")
  const { tab, booking, deal } = await searchParams
  const [profile, rows, supporting, templates, calendarEntries] = await Promise.all([
    getPortalProfile(),
    getOperationsWorkflowRows(),
    getOperationsSupportingData(),
    loadOperationsEmailTemplates(),
    loadOperationsCalendarEntries(),
  ])
  const [contacts, proofs] = await Promise.all([
    loadOperationsAccountContacts(rows.map((row) => row.accountId).filter((id): id is string => Boolean(id))),
    loadOperationsDeliveryProofs(
      rows.map((row) => row.id),
      rows.map((row) => row.dealId).filter((id): id is string => Boolean(id)),
    ),
  ])
  return (
    <OperationsClient
      initialRows={rows}
      supporting={{ ...supporting, contacts, proofs, templates, calendarEntries }}
      canManage={hasCmsPermission(profile, "operations.manage")}
      initialTab={tab}
      initialBookingId={booking}
      initialDealId={deal}
    />
  )
}
