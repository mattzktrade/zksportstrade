import type { AdminRaceOption } from "@/lib/admin/queries"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"
import { eventSeasonLabel } from "@/lib/catalog/event-label"

export function adminRaceSeasonYear(r: Pick<AdminRaceOption, "id" | "season">): number | null {
  return r.season ?? seasonFromRaceId(r.id)
}

/** e.g. "2027 Australian Grand Prix" — distinguishes seasons in admin dropdowns. */
export function adminRaceLabel(r: AdminRaceOption): string {
  return eventSeasonLabel(r.name, adminRaceSeasonYear(r))
}
