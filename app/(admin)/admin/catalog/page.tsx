import { Suspense } from "react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminRaceOptions } from "@/lib/admin/queries"
import { CatalogInventoryClient } from "./catalog-inventory-client"
import { CatalogPackageRedirect } from "./redirect-package"

export default async function AdminCatalogPage() {
  await requireAdmin()
  const races = await getAdminRaceOptions()

  return (
    <div className="mx-auto max-w-[1540px] p-4 lg:p-5">
      <Suspense fallback={null}>
        <CatalogPackageRedirect />
      </Suspense>
      <CatalogInventoryClient races={races} />
    </div>
  )
}
