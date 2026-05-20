import Link from "next/link"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAllOrdersForAdmin } from "@/lib/orders/queries"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

export const dynamic = "force-dynamic"

const OrdersAdminClient = nextDynamic(
  () => import("./orders-admin-client").then((m) => ({ default: m.OrdersAdminClient })),
  { loading: () => <PageLoadingSpinner /> },
)

export default async function AdminOrdersPage() {
  await requireAdmin()
  const orders = await getAllOrdersForAdmin()

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live portal bookings from Supabase. Search and sort the table, filter by payment status, and update workflow
            (defaults to confirmed). Stock is decremented when a booking is placed.
          </p>
        </div>
        <Link
          href="/admin/place-order"
          className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
        >
          Place order for agent
        </Link>
      </div>

      <OrdersAdminClient orders={orders} />

      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  )
}
