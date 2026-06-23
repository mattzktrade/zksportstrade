import { notFound } from "next/navigation"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageById, getAdminRaceOptions, getLinkedInventoryPackages } from "@/lib/admin/queries"
import { getOrdersForPackage } from "@/lib/orders/queries"
import { getWixChannelListingsForPackage } from "@/lib/admin/wix-channel-listings"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

export const dynamic = "force-dynamic"

const PackageDetailClient = nextDynamic(
  () => import("@/components/admin/package-detail-client").then((m) => ({ default: m.PackageDetailClient })),
  { loading: () => <PageLoadingSpinner /> },
)

type Props = { params: Promise<{ packageId: string }> }

export default async function AdminPackageDetailPage({ params }: Props) {
  await requireAdmin()
  const { packageId } = await params
  const decodedId = decodeURIComponent(packageId)

  const [pkg, races, orders, wixListings] = await Promise.all([
    getAdminPackageById(decodedId),
    getAdminRaceOptions(),
    getOrdersForPackage(decodedId),
    getWixChannelListingsForPackage(decodedId),
  ])

  if (!pkg) notFound()

  const linkedPackages = pkg.inventory_group_id
    ? await getLinkedInventoryPackages(pkg.inventory_group_id)
    : []

  return (
    <div className="p-4 lg:p-6 max-w-none">
      <PackageDetailClient
        pkg={pkg}
        races={races}
        orders={orders}
        wixListings={wixListings}
        linkedPackages={linkedPackages}
      />
    </div>
  )
}
