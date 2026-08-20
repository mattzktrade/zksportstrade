import nextDynamic from "next/dynamic"
import { AlertTriangle, CircleDollarSign, Clock3, PackageCheck } from "lucide-react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getPurchaseOrdersWithMeta } from "@/lib/admin/purchase-orders"
import { getCrmCompanyOptions } from "@/lib/crm/deals"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { AdminPageHeader, AdminStatCard } from "@/components/admin/admin-page-kit"

export const dynamic = "force-dynamic"

const PurchaseOrdersClient = nextDynamic(
  () => import("./purchase-orders-client").then((m) => ({ default: m.PurchaseOrdersClient })),
  { loading: () => <PageLoadingSpinner /> },
)

type Props = {
  searchParams: Promise<{ po?: string }>
}

export default async function AdminPurchaseOrdersPage({ searchParams }: Props) {
  await requireAdmin()
  const { po } = await searchParams
  const [orders, companies] = await Promise.all([getPurchaseOrdersWithMeta(), getCrmCompanyOptions()])
  const awaitingDocs = orders.filter((order) => order.documents.length === 0).length
  const totalUnits = orders.reduce((sum, order) => sum + order.usage.quantity_purchased, 0)
  const remainingUnits = orders.reduce((sum, order) => sum + order.usage.quantity_remaining, 0)

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-4 lg:p-5">
      <AdminPageHeader
        title="Inventory"
        description="Purchase orders — track all stock purchased from suppliers"
      />
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard icon={PackageCheck} value={orders.length} label="Open purchase orders" tone="blue" />
        <AdminStatCard icon={Clock3} value={awaitingDocs} label="Awaiting supplier confirmation" tone="amber" />
        <AdminStatCard icon={CircleDollarSign} value={totalUnits} label="Purchased units tracked" tone="green" />
        <AdminStatCard icon={AlertTriangle} value={remainingUnits} label="Units remaining to sell" tone="red" />
      </section>
      <PurchaseOrdersClient orders={orders} companies={companies} initialPo={po ?? null} />
    </div>
  )
}
