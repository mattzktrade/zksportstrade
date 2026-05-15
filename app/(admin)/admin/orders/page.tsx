import Link from "next/link"
import dynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAllOrdersForAdmin } from "@/lib/orders/queries"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

const OrdersAdminClient = dynamic(
  () => import("./orders-admin-client").then((m) => ({ default: m.OrdersAdminClient })),
  { loading: () => <PageLoadingSpinner /> },
)

export default async function AdminOrdersPage() {
  await requireAdmin()
  const orders = await getAllOrdersForAdmin()

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live portal checkouts from Supabase. Search and sort the table, filter by invoice workflow, and update invoice
          status (defaults to waiting to be invoiced). Stock is decremented when an order is placed.
        </p>
      </div>

      <OrdersAdminClient orders={orders} />

      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  )
}
