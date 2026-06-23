import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { createBookingApprovalApproveToken } from "@/lib/booking-approval/approve-token"

export function buildBookingApprovalAdminReviewUrl(): string {
  return `${getServerSiteOrigin()}/admin/booking-requests`
}

export function buildBookingApprovalApproveUrl(requestId: string): string {
  const token = createBookingApprovalApproveToken(requestId)
  return `${getServerSiteOrigin()}/api/booking-requests/approve?token=${encodeURIComponent(token)}`
}
