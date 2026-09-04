import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminCatalogListRows } from "@/lib/admin/queries"
import {
  adminPackageNetQuantity,
  adminPackageSellable,
} from "@/lib/inventory/effective-availability"
import { getCrmAccountOptions } from "@/lib/crm/deals"
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
  const [data, packages, accountOptions, staffOptions, suppliers] = await Promise.all([
    getDealDetailPageData(decodeURIComponent(dealId)),
    getAdminCatalogListRows(),
    getCrmAccountOptions(),
    getSalesStaffOptions(),
    getSuppliers(),
  ])
  if (!data) notFound()

  const packageOptions = packages
    .filter((row) => !row.shell_parent_package_id)
    .map((row) => ({
      id: row.id,
      label: `${row.race_name} — ${row.name}`,
      eventId: row.race_id,
      eventName: row.race_name,
      packageName: row.name,
      price: row.trade_price,
      currency: row.currency || "USD",
      stockLeft: adminPackageSellable(row),
      netStock: adminPackageNetQuantity(row),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

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
