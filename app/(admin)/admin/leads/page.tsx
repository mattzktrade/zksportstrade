import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminRaceOptions } from "@/lib/admin/queries"
import { getClientDirectoryRows, getSalesStaffOptions } from "@/lib/crm/leads"
import { LeadsClient } from "./leads-client"

export const dynamic = "force-dynamic"

export default async function LeadsPage() {
  const profile = await requireAdmin()
  const [clients, staffOptions, races] = await Promise.all([
    getClientDirectoryRows(),
    getSalesStaffOptions(),
    getAdminRaceOptions(),
  ])

  return (
    <div className="mx-auto max-w-[1540px] p-5 lg:p-7">
      <LeadsClient
        clients={clients}
        staffOptions={staffOptions}
        races={races}
        currentProfileId={profile.id}
      />
    </div>
  )
}
