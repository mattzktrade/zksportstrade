import { notFound } from "next/navigation"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import {
  getAdminPackageById,
  getAdminRaceOptions,
  getLinkedInventoryPackages,
  getLinkedShellInventoryPackages,
} from "@/lib/admin/queries"
import { getLinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { enrichPackageSalesBreakdownWithOpenPipeline } from "@/lib/admin/package-sales-breakdown-sf"
import { getOrdersForPackage } from "@/lib/orders/queries"
import { getWixChannelListingsForPackage } from "@/lib/admin/wix-channel-listings"
import { getPurchaseOrders } from "@/lib/admin/purchase-orders"
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

  const [linkedDayOverview, pkg, races, orders, wixListings, purchaseOrders, fulfilmentBlocks] =
    await Promise.all([
      getLinkedDayPackageOverview(decodedId),
      getAdminPackageById(decodedId),
      getAdminRaceOptions(),
      getOrdersForPackage(decodedId),
      getWixChannelListingsForPackage(decodedId),
      getPurchaseOrders(),
      getFulfilmentBlocksWithUsage(decodedId),
    ])

  if (!pkg) notFound()

  const groupId = pkg.inventory_group_id?.trim() || null
  const shellParentId = linkedDayOverview.threeDayParentId

  // Apply open-pipeline holds into package_inventory (storefront/Wix read qty_available).
  // Admin commitment UI can show −12; DB/storefront stay at max(0, …) = 0 when oversold.
  if (groupId) {
    const healed = await healLinkedGroupInBackground(groupId)
    if (healed) {
      const refreshed = await getAdminPackageById(decodedId)
      if (refreshed) {
        Object.assign(pkg, refreshed)
      }
    }
  }

  const [linkedPackages, linkedShellPackages] = await Promise.all([
    groupId ? getLinkedInventoryPackages(groupId) : Promise.resolve([]),
    shellParentId ? getLinkedShellInventoryPackages(shellParentId) : Promise.resolve([]),
  ])

  // Prefer pkg.sales_breakdown for the current package id — linkedPackages loads a
  // separate object for the same id, and overwriting it here meant enrichment never
  // reached the inventory UI (SF Pipeline stayed 0 while Sold still showed 140).
  const breakdowns = new Map<string, typeof pkg.sales_breakdown>()
  breakdowns.set(pkg.id, pkg.sales_breakdown)
  for (const lp of linkedPackages) {
    if (lp.id === pkg.id) {
      lp.sales_breakdown = pkg.sales_breakdown
      continue
    }
    breakdowns.set(lp.id, lp.sales_breakdown)
  }
  for (const lp of linkedShellPackages) {
    if (lp.id === pkg.id) {
      lp.sales_breakdown = pkg.sales_breakdown
      continue
    }
    breakdowns.set(lp.id, lp.sales_breakdown)
  }

  await enrichPackageSalesBreakdownWithOpenPipeline(breakdowns, [
    { id: pkg.id, salesforce_product_id: pkg.salesforce_product_id ?? null },
    ...linkedPackages.map((p) => ({ id: p.id, salesforce_product_id: p.salesforce_product_id })),
    ...linkedShellPackages.map((p) => ({ id: p.id, salesforce_product_id: p.salesforce_product_id })),
  ])

  return (
    <div className="p-4 lg:p-6 max-w-none">
      <PackageDetailClient
        pkg={pkg}
        races={races}
        orders={orders}
        wixListings={wixListings}
        linkedPackages={linkedPackages}
        linkedShellPackages={linkedShellPackages}
        linkedDayOverview={linkedDayOverview}
        purchaseOrders={purchaseOrders}
        fulfilmentBlocks={fulfilmentBlocks}
        initialTab={initialTab}
      />
    </div>
  )
}
