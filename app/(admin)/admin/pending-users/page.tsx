import { requireAdmin } from "@/lib/admin/require-admin"
import { getPendingProfiles } from "@/lib/admin/queries"
import { PendingUsersTable } from "./pending-users-table"

export default async function AdminPendingUsersPage() {
  await requireAdmin()
  const profiles = await getPendingProfiles()

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pending users</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve trade partners to grant catalog access, or reject with an internal note.
        </p>
      </div>
      <PendingUsersTable profiles={profiles} />
    </div>
  )
}
