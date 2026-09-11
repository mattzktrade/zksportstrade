import { notFound } from "next/navigation"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import {
  getAdminPackageById,
  getAdminRaceOptions,
  getLinkedInventoryPackages,
  type AdminPackageRow,
} from "@/lib/admin/queries"
import { getLinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { getDealsForPackages } from "@/lib/crm/deals"
import { getOrdersForPackages } from "@/lib/orders/queries"
import { getWixChannelListingsForPackage } from "@/lib/admin/wix-channel-listings"
import { ensurePurchaseOrdersForPackageLayers, getPurchaseOrders } from "@/lib/admin/purchase-orders"
import { getFulfilmentBlocksWithUsage } from "@/lib/admin/fulfilment-blocks"
import { parseAdminPackageTab } from "@/lib/admin/package-link"
import { getPackageGuestList } from "@/lib/admin/package-guest-list"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { healLinkedGroupInBackground } from "@/lib/inventory/linked-group-inventory"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { LinkedInventoryPackage } from "@/lib/admin/linked-inventory"

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
  const profile = await requireAdmin()
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
  const groupId = initialPkg.inventory_group_id?.trim() || null
  const [races, orders, deals, wixListings, initialPurchaseOrders, fulfilmentBlocks, healed] =
    await Promise.all([
      getAdminRaceOptions(),
      getOrdersForPackages(linkedSalePackageIds),
      getDealsForPackages(linkedSalePackageIds),
      getWixChannelListingsForPackage(decodedId),
      getPurchaseOrders(),
      getFulfilmentBlocksWithUsage(decodedId),
      groupId ? healLinkedGroupInBackground(groupId) : Promise.resolve(false),
    ])

  let pkg = initialPkg
  let purchaseOrders = initialPurchaseOrders

  // Apply open-pipeline holds into package_inventory (storefront/Wix read qty_available).
  // Admin commitment UI can show −12; DB/storefront stay at max(0, …) = 0 when oversold.
  if (healed) {
    const refreshed = await getAdminPackageById(decodedId)
    if (refreshed) pkg = refreshed
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

  const guestListPackages = guestListPackageMeta(pkg, linkedPackages, linkedDayOverview.siblings)
  const guestList = await getPackageGuestList({
    deals,
    orders,
    packages: guestListPackages,
    eventDate: linkedDayOverview.raceEventDate ?? pkg.event_date ?? null,
    purchaseOrders,
    costLayers: uniqueCostLayers(pkg, linkedPackages),
  })

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
        guestList={guestList}
        canManageGuests={hasCmsPermission(profile, "operations.manage")}
        initialTab={initialTab}
      />
    </div>
  )
}

function guestListPackageMeta(
  pkg: AdminPackageRow,
  linkedPackages: LinkedInventoryPackage[],
  siblings: Array<{ id: string; name: string; duration: string | null }>,
): Array<{ id: string; name: string; duration: string | null }> {
  const map = new Map<string, { id: string; name: string; duration: string | null }>()
  map.set(pkg.id, { id: pkg.id, name: pkg.name, duration: pkg.duration ?? null })
  for (const linked of linkedPackages) {
    map.set(linked.id, { id: linked.id, name: linked.name, duration: linked.duration })
  }
  if (linkedPackages.length === 0) {
    for (const sibling of siblings) {
      map.set(sibling.id, { id: sibling.id, name: sibling.name, duration: sibling.duration })
    }
  }
  return [...map.values()]
}

function uniqueCostLayers(pkg: AdminPackageRow, linkedPackages: LinkedInventoryPackage[]): CostLayerRow[] {
  return [
    ...new Map(
      [...(pkg.cost_layers ?? []), ...linkedPackages.flatMap((linked) => linked.cost_layers ?? [])].map((layer) => [
        layer.id,
        layer,
      ]),
    ).values(),
  ]
}
