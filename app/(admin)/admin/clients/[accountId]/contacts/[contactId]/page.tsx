import { notFound } from "next/navigation"
import { CrmEntityProfileView } from "@/components/admin/crm-entity-profile"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminRaceOptions } from "@/lib/admin/queries"
import { findSupplierIdForAccount, getSupplierProfile } from "@/lib/admin/supplier-profile"
import { getCrmEntityProfile } from "@/lib/crm/profiles"
import { getSalesStaffOptions } from "@/lib/crm/leads"

export const dynamic = "force-dynamic"

export default async function AdminContactProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string; contactId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdmin()
  const { accountId, contactId } = await params
  const { tab } = await searchParams
  const [profile, staffOptions, races] = await Promise.all([
    getCrmEntityProfile(decodeURIComponent(accountId), decodeURIComponent(contactId)),
    getSalesStaffOptions(),
    getAdminRaceOptions(),
  ])
  if (!profile) notFound()
  const supplierId = await findSupplierIdForAccount(profile.account)
  const supplier = supplierId ? await getSupplierProfile(supplierId) : null

  return (
    <CrmEntityProfileView
      profile={profile}
      supplier={supplier}
      tab={tab === "supplier" ? "supplier" : "customer"}
      staffOptions={staffOptions}
      races={races}
    />
  )
}
