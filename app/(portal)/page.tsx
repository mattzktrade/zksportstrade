import { RacesGrid } from "@/components/dashboard/races-grid"
import { getCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"

export default async function DashboardPage() {
  const profile = await getPortalProfile()
  const catalog = await getCatalog(profile?.id ?? null)

  if (!catalog || catalog.races.length === 0) {
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

  return (
    <div className="p-6 lg:p-8">
      <RacesGrid races={catalog.races} />
    </div>
  )
}
