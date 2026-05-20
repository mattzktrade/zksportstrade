import { notFound } from "next/navigation"
import { getRaceCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"
import { RacePackagesClient } from "./race-packages-client"

export default async function RacePackagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ package?: string }>
}) {
  const { id } = await params
  const { package: highlightPackageId } = await searchParams
  const profile = await getPortalProfile()
  const catalog = await getRaceCatalog(id, profile?.id ?? null)
  if (!catalog) {
    notFound()
  }

  return (
    <RacePackagesClient
      race={catalog.race}
      racePackages={catalog.packages}
      highlightPackageId={highlightPackageId?.trim() || undefined}
    />
  )
}
