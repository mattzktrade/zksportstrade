import { notFound } from "next/navigation"
import { getCatalog } from "@/lib/catalog/queries"
import { getPortalProfile } from "@/lib/supabase/profile"
import { RacePackagesClient } from "./race-packages-client"

export default async function RacePackagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getPortalProfile()
  const catalog = await getCatalog(profile?.id ?? null)
  if (!catalog || catalog.races.length === 0) {
    notFound()
  }

  const race = catalog.races.find((r) => r.id === id)
  if (!race) {
    notFound()
  }

  const racePackages = catalog.packages.filter((pkg) => {
    return (
      pkg.circuit.toLowerCase().includes(race.shortName.toLowerCase()) ||
      pkg.circuit.toLowerCase().includes(race.name.toLowerCase()) ||
      pkg.date === race.date
    )
  })

  return <RacePackagesClient race={race} racePackages={racePackages} />
}
