import { getCatalog } from "@/lib/catalog/queries"
import { PackagesPageClient } from "./packages-page-client"

export default async function PackagesPage() {
  const catalog = await getCatalog()
  if (!catalog || catalog.races.length === 0) {
    return (
      <div className="p-6 lg:p-8 max-w-lg">
        <h1 className="text-xl font-bold text-foreground">Catalog not available</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Connect Supabase (see <code className="text-xs bg-muted px-1 rounded">.env.example</code>), run the SQL migration in{" "}
          <code className="text-xs bg-muted px-1 rounded">supabase/migrations</code>, then run{" "}
          <code className="text-xs bg-muted px-1 rounded">npm run seed:catalog</code>.
        </p>
      </div>
    )
  }

  return <PackagesPageClient races={catalog.races} packages={catalog.packages} />
}
