import { notFound, redirect } from "next/navigation"
import { CrmEntityProfileView } from "@/components/admin/crm-entity-profile"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminRaceOptions } from "@/lib/admin/queries"
import { findAccountIdForSupplier, getSupplierProfile } from "@/lib/admin/supplier-profile"
import { adminAccountPath } from "@/lib/crm/profile-links"
import { getCrmEntityProfile } from "@/lib/crm/profiles"
import { getSalesStaffOptions } from "@/lib/crm/leads"

export const dynamic = "force-dynamic"

export default async function AdminSupplierProfilePage({
  params,
}: {
  params: Promise<{ supplierId: string }>
}) {
  await requireAdmin()
  const { supplierId } = await params
  const supplier = await getSupplierProfile(decodeURIComponent(supplierId))
  if (!supplier) notFound()

  const accountId = await findAccountIdForSupplier(supplier.supplier)
  if (accountId) {
    const profile = await getCrmEntityProfile(accountId)
    if (profile) redirect(adminAccountPath(accountId, "supplier"))
  }

  const [staffOptions, races] = await Promise.all([getSalesStaffOptions(), getAdminRaceOptions()])
  return (
    <CrmEntityProfileView
      profile={null}
      supplier={supplier}
      tab="supplier"
      staffOptions={staffOptions}
      races={races}
    />
  )
}
