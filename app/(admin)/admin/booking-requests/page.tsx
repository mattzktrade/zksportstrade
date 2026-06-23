import { requireAdmin } from "@/lib/admin/require-admin"
import { getPendingBookingApprovalRequestsForAdmin } from "@/lib/booking-approval/queries"
import { BookingRequestsAdminClient } from "./booking-requests-admin-client"

export const dynamic = "force-dynamic"

export default async function AdminBookingRequestsPage() {
  await requireAdmin()
  const requests = await getPendingBookingApprovalRequestsForAdmin()

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Paddock Club requests</h1>
      </div>
      <BookingRequestsAdminClient requests={requests} />
    </div>
  )
}
