import { notFound } from "next/navigation"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import {
  getAdminPackageById,
  getAdminRaceOptions,
  getLinkedInventoryPackages,
} from "@/lib/admin/queries"
import { getLinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { getDealsForPackages } from "@/lib/crm/deals"
import { getOrdersForPackages } from "@/lib/orders/queries"
import { getWixChannelListingsForPackage } from "@/lib/admin/wix-channel-listings"
import { ensurePurchaseOrdersForPackageLayers, getPurchaseOrders } from "@/lib/admin/purchase-orders"
import { getFulfilmentBlocksWithUsage } from "@/lib/admin/fulfilment-blocks"
import { parseAdminPackageTab } from "@/lib/admin/package-link"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { healLinkedGroupInBackground } from "@/lib/inventory/linked-group-inventory"

export const dynamic = "force-dynamic"

const PackageDetailClient = nextDynamic(
  () => import("@/components/admin/package-detail-client").then((m) => ({ default: m.PackageDetailClient })),
  { loading: () => <PageLoadingSpinner /> },
)

type Props = {
  params: Promise<{ packageId: string }>
  searchParams: Promise<{ tab?: string }>
}

export default async function AdminPackageDetailPage({ params, searchParams }: Props) {
  await requireAdmin()
  const { packageId } = await params
  const { tab } = await searchParams
  const decodedId = decodeURIComponent(packageId)
  const initialTab = parseAdminPackageTab(tab ?? null)

  const [linkedDayOverview, initialPkg] = await Promise.all([
    getLinkedDayPackageOverview(decodedId),
    getAdminPackageById(decodedId),
  ])

  if (!initialPkg) notFound()
  const linkedSalePackageIds =
    linkedDayOverview.inventoryGroupId && linkedDayOverview.siblings.length > 0
      ? linkedDayOverview.siblings.map((pkg) => pkg.id)
      : [decodedId]
  const [races, orders, deals, wixListings, initialPurchaseOrders, fulfilmentBlocks] =
    await Promise.all([
      getAdminRaceOptions(),
      getOrdersForPackages(linkedSalePackageIds),
      getDealsForPackages(linkedSalePackageIds),
      getWixChannelListingsForPackage(decodedId),
      getPurchaseOrders(),
      getFulfilmentBlocksWithUsage(decodedId),
    ])

  let pkg = initialPkg
  let purchaseOrders = initialPurchaseOrders
  const groupId = pkg.inventory_group_id?.trim() || null

  // Apply open-pipeline holds into package_inventory (storefront/Wix read qty_available).
  // Admin commitment UI can show −12; DB/storefront stay at max(0, …) = 0 when oversold.
  if (groupId) {
    const healed = await healLinkedGroupInBackground(groupId)
    if (healed) {
      const refreshed = await getAdminPackageById(decodedId)
      if (refreshed) pkg = refreshed
    }
  }

  if (pkg.cost_layers.some((layer) => !layer.purchase_order_id)) {
    const created = await ensurePurchaseOrdersForPackageLayers(decodedId)
    if (created > 0) {
      const [refreshedPkg, refreshedPos] = await Promise.all([
        getAdminPackageById(decodedId),
        getPurchaseOrders(),
      ])
      if (refreshedPkg) pkg = refreshedPkg
      purchaseOrders = refreshedPos
    }
  }

  const linkedPackages = groupId ? await getLinkedInventoryPackages(groupId) : []
  for (const lp of linkedPackages) {
    if (lp.id === pkg.id) lp.sales_breakdown = pkg.sales_breakdown
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-none">
      <PackageDetailClient
        pkg={pkg}
        races={races}
        orders={orders}
        deals={deals}
        wixListings={wixListings}
        linkedPackages={linkedPackages}
        linkedDayOverview={linkedDayOverview}
        purchaseOrders={purchaseOrders}
        fulfilmentBlocks={fulfilmentBlocks}
        initialTab={initialTab}
      />
    </div>
  )
}
