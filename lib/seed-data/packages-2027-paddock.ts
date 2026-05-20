import type { Package, Race } from "../types/catalog"
import { circuitKeyFromRaceId } from "../catalog/season-rollover"

const PADDOCK_INCLUDES = ["Paddock Access", "Gourmet Dining", "Open Bar", "Pit Lane Walk"]

/** One enquire-only 3-day Paddock Club package per 2027 race. */
export function packages2027PaddockEnquire(races2027: Race[]): Package[] {
  return races2027.map((race) => {
    const key = circuitKeyFromRaceId(race.id)
    return {
      id: `${key}-paddock-club-2027`,
      name: "3 Day Paddock Club",
      circuit: race.name,
      location: race.location,
      country: race.country,
      countryCode: race.countryCode,
      date: race.date,
      dateRange: race.dateRange,
      price: null,
      currency: "USD",
      availability: "Enquire",
      totalCapacity: 50,
      image: race.image,
      tier: "paddock",
      duration: "3_day",
      includes: PADDOCK_INCLUDES,
      featured: false,
      isHidden: true,
      raceId: race.id,
    }
  })
}
