import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getPurchaseOrdersWithMeta } from "@/lib/admin/purchase-orders"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

export const dynamic = "force-dynamic"

const PurchaseOrdersClient = nextDynamic(
  () => import("./purchase-orders-client").then((m) => ({ default: m.PurchaseOrdersClient })),
  { loading: () => <PageLoadingSpinner /> },
)

export default async function AdminPurchaseOrdersPage() {
  await requireAdmin()
  const orders = await getPurchaseOrdersWithMeta()

  return (
    <div className="p-4 lg:p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Purchase orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and manage purchase orders created when you add stock on a package. Attach contracts here,
          or add stock directly on a package — each addition creates (or links) a PO automatically.
        </p>
      </div>
      <PurchaseOrdersClient orders={orders} />
    </div>
  )
}
