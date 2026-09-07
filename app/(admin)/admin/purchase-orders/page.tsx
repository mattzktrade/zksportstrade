import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getCrmCompanyOptions } from "@/lib/crm/deals"
import { getPurchaseOrderProductOptions, getPurchaseOrdersWithMeta } from "@/lib/admin/purchase-orders"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"

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
  const [orders, companies, products] = await Promise.all([
    getPurchaseOrdersWithMeta(),
    getCrmCompanyOptions(),
    getPurchaseOrderProductOptions(),
  ])

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Inventory"
        description="Purchase orders — track all stock purchased from suppliers"
      />
      <PurchaseOrdersClient
        orders={orders}
        companies={companies}
        products={products}
        initialPo={po ?? null}
      />
    </div>
  )
}
