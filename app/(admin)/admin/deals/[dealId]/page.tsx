import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getCrmAccountOptions, getDealPackagePicker } from "@/lib/crm/deals"
import { getDealDetailPageData } from "@/lib/crm/deal-detail"
import { getSalesStaffOptions } from "@/lib/crm/leads"
import { getSuppliers } from "@/lib/inventory/suppliers"
import { hasCmsPermission, canSendNativeBookingForm, canSignNativeBookingForm } from "@/lib/auth/permissions"
import { DealDetailClient } from "./deal-detail-client"

export const dynamic = "force-dynamic"

export default async function AdminDealDetailPage({
  params,
}: {
  params: Promise<{ dealId: string }>
}) {
  const profile = await requireAdmin()
  const { dealId } = await params
  const [data, packagePicker, accountOptions, staffOptions, suppliers] = await Promise.all([
    getDealDetailPageData(decodeURIComponent(dealId)),
    getDealPackagePicker(),
    getCrmAccountOptions(),
    getSalesStaffOptions(),
    getSuppliers(),
  ])
  if (!data) notFound()

  const { packageOptions } = packagePicker

  return (
    <DealDetailClient
      data={data}
      accountOptions={accountOptions}
      packageOptions={packageOptions}
      staffOptions={staffOptions}
      supplierOptions={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
      currentCanSendBookingForm={canSendNativeBookingForm(profile)}
      currentCanSignBookingForm={canSignNativeBookingForm(profile)}
      currentProfileName={profile.full_name || "ZK Admin"}
      currentCanManageFinance={hasCmsPermission(profile, "finance.manage")}
      canManageOperations={hasCmsPermission(profile, "operations.manage")}
      canManageDeals={hasCmsPermission(profile, "deals.manage")}
    />
  )
}
