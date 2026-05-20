import { RacesGrid } from "@/components/dashboard/races-grid"
import { getPortalCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"

export default async function DashboardPage() {
  const profile = await getPortalProfile()
  const catalog = await getPortalCatalog(profile?.id ?? null)

  if (!catalog) {
    return (
      <div className="p-6 lg:p-8 max-w-xl space-y-3">
        <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
        <p className="text-sm text-muted-foreground">
          Your account is ready, but no race catalog is loaded yet. In Supabase, run the SQL migration, then from your machine run{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">npm run seed:catalog</code> (with{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">SUPABASE_SERVICE_ROLE_KEY</code> set). See{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.env.example</code>.
        </p>
      </div>
    )
  }

  const hasRaces = catalog.seasons.some((s) => s.races.length > 0)
  if (!hasRaces) {
    return (
      <div className="p-6 lg:p-8 max-w-xl space-y-3">
        <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
        <p className="text-sm text-muted-foreground">
          There are no upcoming races open for booking. Your past bookings are still available from the menu.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      <RacesGrid catalog={catalog} />
    </div>
  )
}
