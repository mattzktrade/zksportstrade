import { Suspense } from "react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminRaceOptions } from "@/lib/admin/queries"
import { CatalogInventoryClient } from "./catalog-inventory-client"
import { CatalogPackageRedirect } from "./redirect-package"

export default async function AdminCatalogPage() {
  await requireAdmin()
  const races = await getAdminRaceOptions()

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <Suspense fallback={null}>
        <CatalogPackageRedirect />
      </Suspense>
      <CatalogInventoryClient races={races} />
    </div>
  )
}
