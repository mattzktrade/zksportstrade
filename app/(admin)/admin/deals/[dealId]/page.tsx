import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getDealDetailPageData } from "@/lib/crm/deal-detail"
import { listCallAttemptsForDeals } from "@/lib/crm/call-attempts-store"
import { hasCmsPermission, canSendNativeBookingForm, canSignNativeBookingForm } from "@/lib/auth/permissions"
import { AdminRouteShell } from "@/components/admin/admin-route-shell"
import { DealDetailClient } from "./deal-detail-client"

export const dynamic = "force-dynamic"

export default function AdminDealDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>
}) {
  return (
    <AdminRouteShell>
      <AdminDealDetailBody params={params} />
    </AdminRouteShell>
  )
}

async function AdminDealDetailBody({
  params,
}: {
  params: Promise<{ dealId: string }>
}) {
  const profile = await requireAdmin()
  const { dealId } = await params
  const id = decodeURIComponent(dealId)
  const [data, callsByDeal] = await Promise.all([
    getDealDetailPageData(id),
    listCallAttemptsForDeals([id]),
  ])
  if (!data) notFound()

  return (
    <DealDetailClient
      data={data}
      callSummary={callsByDeal[data.deal.id]}
      currentCanSendBookingForm={canSendNativeBookingForm(profile)}
      currentCanSignBookingForm={canSignNativeBookingForm(profile)}
      currentProfileName={profile.full_name || "ZK Admin"}
      currentCanManageFinance={hasCmsPermission(profile, "finance.manage")}
      canManageOperations={hasCmsPermission(profile, "operations.manage")}
      canManageDeals={hasCmsPermission(profile, "deals.manage")}
    />
  )
}
