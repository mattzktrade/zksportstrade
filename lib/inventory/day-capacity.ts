import type { PackageDurationValue } from "@/lib/catalog/package-duration"

export type DaySlot = "thursday" | "friday" | "saturday" | "sunday"

export type DayCapacityMap = Partial<Record<DaySlot, number>>

const DAY_SLOTS: DaySlot[] = ["thursday", "friday", "saturday", "sunday"]

/** Which physical day slots one sale of this duration consumes. */
export function daySlotsForDuration(
  duration: string | null | undefined,
): DaySlot[] {
  switch (duration) {
    case "3_day":
      return ["friday", "saturday", "sunday"]
    case "2_day":
      return ["saturday", "sunday"]
    case "thursday_only":
      return ["thursday"]
    case "friday_only":
      return ["friday"]
    case "saturday_only":
      return ["saturday"]
    case "sunday_only":
      return ["sunday"]
    default:
      return []
  }
}

export function isDayCapacityDuration(
  duration: string | null | undefined,
): duration is Exclude<PackageDurationValue, ""> {
  return daySlotsForDuration(duration).length > 0
}

/**
 * Sellable units for a product = min(floor(dayOwned / unitsPerSale)) across required days.
 * Missing day capacity is treated as 0.
 */
export function sellableFromDayCapacity(
  ownedByDay: DayCapacityMap,
  requiredDays: readonly DaySlot[],
  unitsPerSale = 1,
): number {
  if (requiredDays.length === 0) return 0
  const perSale = Math.max(1, Math.floor(unitsPerSale))
  let min = Number.POSITIVE_INFINITY
  for (const day of requiredDays) {
    const owned = Math.max(0, Math.floor(ownedByDay[day] ?? 0))
    min = Math.min(min, Math.floor(owned / perSale))
  }
  if (!Number.isFinite(min)) return 0
  return Math.max(0, min)
}

/** Apply a sale/reservation against day capacity. Returns null if insufficient. */
export function consumeDayCapacity(
  ownedByDay: DayCapacityMap,
  requiredDays: readonly DaySlot[],
  quantity: number,
  unitsPerSale = 1,
): DayCapacityMap | null {
  const qty = Math.floor(quantity)
  if (!Number.isFinite(qty) || qty <= 0) return null
  const sellable = sellableFromDayCapacity(ownedByDay, requiredDays, unitsPerSale)
  if (qty > sellable) return null

  const next: DayCapacityMap = { ...ownedByDay }
  const perSale = Math.max(1, Math.floor(unitsPerSale))
  for (const day of requiredDays) {
    next[day] = Math.max(0, Math.floor(next[day] ?? 0) - qty * perSale)
  }
  return next
}

/** Release previously consumed day capacity (cancel / expired reservation). */
export function releaseDayCapacity(
  ownedByDay: DayCapacityMap,
  requiredDays: readonly DaySlot[],
  quantity: number,
  unitsPerSale = 1,
): DayCapacityMap {
  const qty = Math.max(0, Math.floor(quantity))
  const perSale = Math.max(1, Math.floor(unitsPerSale))
  const next: DayCapacityMap = { ...ownedByDay }
  for (const day of requiredDays) {
    next[day] = Math.max(0, Math.floor(next[day] ?? 0) + qty * perSale)
  }
  return next
}

export function emptyDayCapacity(includeThursday = false): DayCapacityMap {
  const out: DayCapacityMap = {
    friday: 0,
    saturday: 0,
    sunday: 0,
  }
  if (includeThursday) out.thursday = 0
  return out
}

export function allDaySlots(): readonly DaySlot[] {
  return DAY_SLOTS
}
