import { circuitKeyFromRaceId } from "@/lib/catalog/season-rollover"

/** Official track names keyed by race-id stem (`australia-2026` → `australia`). */
export const F1_CIRCUIT_NAMES: Record<string, string> = {
  australia: "Albert Park Circuit",
  china: "Shanghai International Circuit",
  japan: "Suzuka International Racing Course",
  bahrain: "Bahrain International Circuit",
  saudi: "Jeddah Corniche Circuit",
  miami: "Miami International Autodrome",
  canada: "Circuit Gilles Villeneuve",
  monaco: "Circuit de Monaco",
  /** Barcelona Grand Prix (`spain-*`). The Spanish Grand Prix is `madrid-*`. */
  spain: "Circuit de Barcelona-Catalunya",
  austria: "Red Bull Ring",
  britain: "Silverstone Circuit",
  belgium: "Circuit de Spa-Francorchamps",
  hungary: "Hungaroring",
  netherlands: "Circuit Zandvoort",
  italy: "Autodromo Nazionale Monza",
  /** Spanish Grand Prix in Madrid. */
  madrid: "MADRING",
  azerbaijan: "Baku City Circuit",
  "bahrain-malaysia": "Sepang International Circuit",
  singapore: "Marina Bay Street Circuit",
  usa: "Circuit of the Americas",
  mexico: "Autódromo Hermanos Rodríguez",
  brazil: "Autódromo José Carlos Pace",
  vegas: "Las Vegas Strip Circuit",
  qatar: "Lusail International Circuit",
  abudhabi: "Yas Marina Circuit",
  portugal: "Algarve International Circuit",
  turkey: "Istanbul Park",
}

export function officialCircuitNameForRaceId(raceId: string): string | null {
  const key = circuitKeyFromRaceId(raceId.trim())
  return F1_CIRCUIT_NAMES[key] ?? null
}

export type RaceEventFieldSource = {
  id: string
  name: string
  circuit?: string | null
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  image?: string | null
}

export function resolveRaceCircuit(
  race: Pick<RaceEventFieldSource, "id" | "circuit" | "location">,
): string {
  const stored = race.circuit?.trim() ?? ""
  if (stored) return stored
  return officialCircuitNameForRaceId(race.id) ?? ""
}

export function packageEventDefaultsFromRace(race: RaceEventFieldSource): {
  circuit: string
  location: string
  country: string
  countryCode: string
  eventDate: string
  dateRange: string
  image: string
} {
  return {
    circuit: resolveRaceCircuit(race),
    location: race.location,
    country: race.country,
    countryCode: race.country_code,
    eventDate: String(race.event_date).slice(0, 10),
    dateRange: race.date_range,
    image: race.image ?? "",
  }
}

/**
 * Use the typed circuit from the event when the package form still has the Grand Prix title.
 * A real override (anything other than the event name) is kept.
 */
export function resolvePackageCircuitInput(
  inputCircuit: string,
  race: Pick<RaceEventFieldSource, "id" | "name" | "circuit" | "location">,
): string {
  const input = inputCircuit.trim()
  const fromRace = resolveRaceCircuit(race)
  if (!input) return fromRace
  if (fromRace && input.toLowerCase() === race.name.trim().toLowerCase()) return fromRace
  return input
}

export function isMissingRaceCircuitColumnError(message: string | undefined): boolean {
  return /column\s+(public\.)?races\.circuit\s+does not exist/i.test(message ?? "")
}

export function eventSharedFieldsChanged(
  before: {
    circuit?: string | null
    location: string
    country: string
    country_code: string
    event_date: string
    date_range: string
  },
  after: {
    circuit: string
    location: string
    country: string
    countryCode: string
    eventDate: string
    dateRange: string
  },
): boolean {
  return (
    String(before.circuit ?? "").trim() !== after.circuit.trim() ||
    before.location.trim() !== after.location.trim() ||
    before.country.trim() !== after.country.trim() ||
    before.country_code.trim().toUpperCase() !== after.countryCode.trim().toUpperCase() ||
    String(before.event_date).slice(0, 10) !== after.eventDate.slice(0, 10) ||
    before.date_range.trim() !== after.dateRange.trim()
  )
}
