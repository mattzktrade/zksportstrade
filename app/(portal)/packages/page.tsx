import { getCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"
import { PackagesPageClient } from "./packages-page-client"

export default async function PackagesPage() {
  const profile = await getPortalProfile()
  const catalog = await getCatalog(profile?.id ?? null)
  if (!catalog) {
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
  if (catalog.races.length === 0) {
    return (
      <div className="p-6 lg:p-8 max-w-lg space-y-2">
        <h1 className="text-xl font-bold text-foreground">No upcoming events</h1>
        <p className="text-sm text-muted-foreground">
          There are no races open for booking right now. Past events are hidden from the catalog, but your bookings and
          invoices are still available in the menu.
        </p>
      </div>
    )
  }

  return <PackagesPageClient races={catalog.races} packages={catalog.packages} />
}
