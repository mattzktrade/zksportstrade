import { Suspense } from "react"
import { DashboardHero } from "@/components/dashboard/dashboard-hero"
import { RacesGrid } from "@/components/dashboard/races-grid"
import { getPortalCatalog } from "@/lib/catalog/queries"

function HomeCatalogFallback() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-40 rounded-2xl bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="aspect-[4/3] rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  )
}

async function HomeCatalog() {
  const catalog = await getPortalCatalog(undefined, { sellable: "featured" })

  if (!catalog) {
    return (
      <div className="max-w-xl space-y-3">
        <p className="text-sm text-muted-foreground">
          Your account is ready, but no race catalog is loaded yet. In Supabase, run the SQL migration, then from your machine run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run seed:catalog</code> (with{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">SUPABASE_SERVICE_ROLE_KEY</code> set). See{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">.env.example</code>.
        </p>
      </div>
    )
  }

  const hasRaces = catalog.seasons.some((s) => s.races.length > 0)
  if (!hasRaces) {
    return (
      <p className="max-w-xl text-sm text-muted-foreground">
        There are no upcoming races open for booking. Your past bookings are still available from the menu.
      </p>
    )
  }

  return <RacesGrid catalog={catalog} />
}

export default function DashboardPage() {
  return (
    <div className="p-6 lg:p-8">
      <DashboardHero />
      <Suspense fallback={<HomeCatalogFallback />}>
        <HomeCatalog />
      </Suspense>
    </div>
  )
}
