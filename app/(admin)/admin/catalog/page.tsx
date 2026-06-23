import { Suspense } from "react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageRows, getAdminRaceOptions } from "@/lib/admin/queries"
import { getWixChannelListingsByPackage } from "@/lib/admin/wix-channel-listings"
import { CatalogInventoryClient } from "./catalog-inventory-client"
import { CatalogPackageRedirect } from "./redirect-package"

export default async function AdminCatalogPage() {
  await requireAdmin()
  const [rows, races, wixListingsByPackage] = await Promise.all([
    getAdminPackageRows(),
    getAdminRaceOptions(),
    getWixChannelListingsByPackage(),
  ])

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <Suspense fallback={null}>
        <CatalogPackageRedirect />
      </Suspense>
      <CatalogInventoryClient rows={rows} races={races} wixListingsByPackage={wixListingsByPackage} />
    </div>
  )
}
