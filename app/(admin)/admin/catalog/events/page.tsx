import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { isEventCategory } from "@/lib/catalog/event-categories"
import { officialCircuitNameForRaceId, isMissingRaceCircuitColumnError } from "@/lib/catalog/race-circuit"
import { EventsClient, type NativeEventRow } from "./events-client"

export const dynamic = "force-dynamic"

export default async function EventsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const withCircuit =
    "id, name, short_name, circuit, location, country, country_code, event_date, date_range, image, season, category, is_archived"
  const withoutCircuit =
    "id, name, short_name, location, country, country_code, event_date, date_range, image, season, category, is_archived"
  const [eventsResult, packagesResult] = await Promise.all([
    supabase.from("races").select(withCircuit).order("event_date"),
    supabase.from("packages").select("race_id, circuit"),
  ])
  const events =
    eventsResult.error && isMissingRaceCircuitColumnError(eventsResult.error.message)
      ? ((await supabase.from("races").select(withoutCircuit).order("event_date")).data ?? []).map((row) => ({
          ...row,
          circuit: "",
        }))
      : eventsResult.data
  const packages = packagesResult.data

  const counts = new Map<string, number>()
  const circuitByRace = new Map<string, string>()
  for (const pkg of packages ?? []) {
    counts.set(pkg.race_id, (counts.get(pkg.race_id) ?? 0) + 1)
    const circuit = String((pkg as { circuit?: string | null }).circuit ?? "").trim()
    if (circuit && !circuitByRace.has(pkg.race_id)) circuitByRace.set(pkg.race_id, circuit)
  }

  const rows: NativeEventRow[] = (events ?? []).map((event) => ({
    ...event,
    circuit:
      String((event as { circuit?: string | null }).circuit ?? "").trim() ||
      circuitByRace.get(String(event.id)) ||
      officialCircuitNameForRaceId(String(event.id)) ||
      "",
    category: isEventCategory(String(event.category)) ? event.category : "other",
    event_date: String(event.event_date),
    is_archived: Boolean(event.is_archived),
    product_count: counts.get(event.id) ?? 0,
  }))

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
      <EventsClient events={rows} />
    </div>
  )
}
