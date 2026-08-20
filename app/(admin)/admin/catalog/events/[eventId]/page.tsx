import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getNativeEventDetail } from "@/lib/admin/event-detail"
import { EventDetailClient } from "./event-detail-client"

export const dynamic = "force-dynamic"

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  await requireAdmin()
  const { eventId } = await params
  const detail = await getNativeEventDetail(decodeURIComponent(eventId))
  if (!detail) notFound()

  return (
    <div className="mx-auto max-w-[1540px] p-5 lg:p-7">
      <EventDetailClient detail={detail} />
    </div>
  )
}
