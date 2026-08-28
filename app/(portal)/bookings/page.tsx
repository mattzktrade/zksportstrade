import { getMyBookings } from "@/lib/orders/queries"
import { BookingsPageClient } from "./bookings-page-client"

export const dynamic = "force-dynamic"

export default async function BookingsPage() {
  const bookings = await getMyBookings()
  return <BookingsPageClient initialBookings={bookings} />
}
