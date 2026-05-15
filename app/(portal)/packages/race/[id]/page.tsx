import { notFound } from "next/navigation"
import { getRaceCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"
import { RacePackagesClient } from "./race-packages-client"

export default async function RacePackagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getPortalProfile()
  const catalog = await getRaceCatalog(id, profile?.id ?? null)
  if (!catalog) {
    notFound()
  }

  return <RacePackagesClient race={catalog.race} racePackages={catalog.packages} />
}
