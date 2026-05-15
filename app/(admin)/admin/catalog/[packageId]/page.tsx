import { notFound } from "next/navigation"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageById, getAdminRaceOptions } from "@/lib/admin/queries"
import { getOrdersForPackage } from "@/lib/orders/queries"
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

  const [pkg, races, orders] = await Promise.all([
    getAdminPackageById(decodedId),
    getAdminRaceOptions(),
    getOrdersForPackage(decodedId),
  ])

  if (!pkg) notFound()

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <PackageDetailClient pkg={pkg} races={races} orders={orders} />
    </div>
  )
}
