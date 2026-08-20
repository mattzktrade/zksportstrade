import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { isEventCategory } from "@/lib/catalog/event-categories"
import { EventsClient, type NativeEventRow } from "./events-client"

export const dynamic = "force-dynamic"

export default async function EventsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [{ data: events }, { data: packages }] = await Promise.all([
    supabase
      .from("races")
      .select("id, name, short_name, location, country, country_code, event_date, date_range, image, season, category, is_archived")
      .order("event_date"),
    supabase.from("packages").select("race_id"),
  ])

  const counts = new Map<string, number>()
  for (const pkg of packages ?? []) {
    counts.set(pkg.race_id, (counts.get(pkg.race_id) ?? 0) + 1)
  }

  const rows: NativeEventRow[] = (events ?? []).map((event) => ({
    ...event,
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
