import type { Race } from "@/lib/types/catalog"
import { circuitKeyFromRaceId, DATES_TBC_LABEL } from "@/lib/catalog/season-rollover"

/**
 * 2027 F1 calendar adjustments (confirmed 2025–2026):
 * - Portuguese GP at Portimão replaces the Dutch GP (Zandvoort ends after 2026).
 * - The early-June European slot held by Barcelona/Catalunya in 2026 becomes Portugal in 2027 (not Spanish GP at Barcelona).
 * - Turkish GP returns at Istanbul Park; Barcelona-Catalunya and Dutch GP are off the 2027 calendar.
 *
 * Madrid Grand Prix remains a separate 2027 round (Spain, later in the season).
 */
export function apply2027CalendarAdjustments(races2027: Race[]): Race[] {
  let races = races2027.filter((r) => circuitKeyFromRaceId(r.id) !== "netherlands")

  const spainIndex = races.findIndex((r) => r.id === "spain-2027")
  if (spainIndex >= 0) {
    const spain = races[spainIndex]
    const next = [...races]
    next[spainIndex] = portugalRaceFromSpainSlot(spain)
    races = next
  }

  if (!races.some((r) => r.id === "turkey-2027")) {
    races = insertTurkey2027(races)
  }

  races.sort((a, b) => a.date.localeCompare(b.date))
  return races
}

function portugalRaceFromSpainSlot(spain: Race): Race {
  return {
    ...spain,
    id: "portugal-2027",
    name: "Portuguese Grand Prix",
    shortName: "Portugal",
    location: "Portimão",
    country: "Portugal",
    countryCode: "PT",
    dateRange: DATES_TBC_LABEL,
    image: "/images/circuits/portimao.jpg",
    season: 2027,
  }
}

/** Istanbul Park — typically between Italy/Madrid and Azerbaijan on the 2027 calendar. */
function buildTurkey2027Race(): Race {
  return {
    id: "turkey-2027",
    name: "Turkish Grand Prix",
    shortName: "Turkey",
    location: "Istanbul",
    country: "Türkiye",
    countryCode: "TR",
    date: "2027-09-19",
    dateRange: DATES_TBC_LABEL,
    image: "/images/circuits/istanbul.jpg",
    packagesAvailable: 4,
    lowestPrice: 4000,
    season: 2027,
  }
}

function insertTurkey2027(races: Race[]): Race[] {
  const turkey = buildTurkey2027Race()
  const madridIndex = races.findIndex((r) => r.id === "madrid-2027")
  const azerbaijanIndex = races.findIndex((r) => r.id === "azerbaijan-2027")
  const insertAt =
    madridIndex >= 0
      ? madridIndex + 1
      : azerbaijanIndex >= 0
        ? azerbaijanIndex
        : races.length
  return [...races.slice(0, insertAt), turkey, ...races.slice(insertAt)]
}
