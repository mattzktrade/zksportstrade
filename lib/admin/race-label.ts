import type { AdminRaceOption } from "@/lib/admin/queries"
import { seasonFromRaceId } from "@/lib/catalog/season-rollover"

export function adminRaceSeasonYear(r: Pick<AdminRaceOption, "id" | "season">): number | null {
  return r.season ?? seasonFromRaceId(r.id)
}

/** e.g. "Australian Grand Prix (2027)" — distinguishes seasons in admin dropdowns. */
export function adminRaceLabel(r: AdminRaceOption): string {
  const year = adminRaceSeasonYear(r)
  return year != null ? `${r.name} (${year})` : r.name
}
