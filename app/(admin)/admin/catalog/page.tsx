import dynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminPackageRows, getAdminRaceOptions } from "@/lib/admin/queries"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { CatalogNewPackage } from "./catalog-new-package"

const CatalogAdminTable = dynamic(
  () => import("./catalog-admin-table").then((m) => ({ default: m.CatalogAdminTable })),
  { loading: () => <PageLoadingSpinner /> },
)

export default async function AdminCatalogPage() {
  await requireAdmin()
  const [rows, races] = await Promise.all([getAdminPackageRows(), getAdminRaceOptions()])

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Catalog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Edit package copy, imagery, pricing, and stock. Create new packages and assign them to a race — then tune
          inventory and holds from the inventory screen.
        </p>
      </div>
      <CatalogNewPackage races={races} />
      <CatalogAdminTable rows={rows} races={races} />
    </div>
  )
}
