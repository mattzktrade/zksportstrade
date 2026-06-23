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

type Props = { searchParams: Promise<{ payment?: string }> }

export default async function AdminOrdersPage({ searchParams }: Props) {
  await requireAdmin()
  const { payment } = await searchParams
  const orders = await getAllOrdersForAdmin()

  const initialPaymentFilter =
    payment === "awaiting_payment" || payment === "paid" || payment === "delivered" ? payment : undefined

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live bookings from trade agents on the portal. Filter by payment and delivery status, update invoices, and
          download PDFs.
        </p>
      </div>

      <OrdersAdminClient orders={orders} initialPaymentFilter={initialPaymentFilter} />

      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  )
}
