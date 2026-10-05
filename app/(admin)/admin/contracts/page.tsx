import { requireCmsPermission } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { loadBookingFormRegister, loadInclusionContracts } from "@/lib/contracts/queries"
import { ContractsClient } from "./contracts-client"

export const dynamic = "force-dynamic"

export default async function ContractsPage() {
  const profile = await requireCmsPermission("deals.view")
  let contracts: Awaited<ReturnType<typeof loadInclusionContracts>>["contracts"] = []
  let unavailable = false
  try {
    const loaded = await loadInclusionContracts()
    contracts = loaded.contracts
    unavailable = loaded.unavailable
  } catch {
    unavailable = true
  }
  const bookingForms = await loadBookingFormRegister()

  return (
    <ContractsClient
      contracts={contracts}
      bookingForms={bookingForms}
      unavailable={unavailable}
      canManage={hasCmsPermission(profile, "deals.manage")}
    />
  )
}
