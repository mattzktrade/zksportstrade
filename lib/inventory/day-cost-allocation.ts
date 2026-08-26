/**
 * Client-safe linked-day cost allocation helpers.
 *
 * Prices and manual percentages are normalized with integer precision so the
 * returned weights always total exactly 1 at the configured scale.
 */

export type CostDaySlot =
  | "thursday_only"
  | "friday_only"
  | "saturday_only"
  | "sunday_only"

export type DayPriceMember = {
  packageId: string
  duration: string | null
  tradePrice: number | null
}

export type DayWeight = {
  day: CostDaySlot
  packageId: string | null
  tradePrice: number | null
  weight: number | null
}

export type DerivedDayWeights =
  | {
      status: "derived"
      rows: DayWeight[]
      missingDays: []
    }
  | {
      status: "setup_required"
      rows: DayWeight[]
      missingDays: CostDaySlot[]
    }

export type ManualWeightValidation =
  | { ok: true; weights: Record<CostDaySlot, number> }
  | { ok: false; message: string }

const WEIGHT_SCALE = 1_000_000_000
const PERCENT_SCALE = 1_000_000
const DAY_SLOTS: readonly CostDaySlot[] = [
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
]

export function isCostDaySlot(value: string | null | undefined): value is CostDaySlot {
  return DAY_SLOTS.includes(value as CostDaySlot)
}

function eventWeekday(eventDate: string | null | undefined): number | null {
  const value = eventDate?.trim()
  if (!value) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay()
}

/** Returns the actual day slots represented by a package purchase. */
export function costDaySlotsForDuration(
  duration: string | null | undefined,
  eventDate: string | null | undefined,
): CostDaySlot[] {
  const threeDay: CostDaySlot[] =
    eventWeekday(eventDate) === 6
      ? ["thursday_only", "friday_only", "saturday_only"]
      : ["friday_only", "saturday_only", "sunday_only"]
  const normalized = duration?.trim() ?? ""
  if (normalized === "3_day") return threeDay
  if (normalized === "2_day") return threeDay.slice(-2)
  return isCostDaySlot(normalized) ? [normalized] : []
}

/** Keep purchased units separate from package-specific day capacity. */
export function targetDaySlotCapacity(
  purchased: number,
  capacityBySlot: Readonly<Record<string, number>>,
  targetSlots: readonly string[],
): number {
  const purchasedUnits = Math.max(0, Math.floor(Number(purchased) || 0))
  if (
    targetSlots.length === 0 ||
    !targetSlots.every((slot) => capacityBySlot[slot] != null)
  ) {
    return purchasedUnits
  }
  return Math.min(
    ...targetSlots.map((slot) =>
      Math.max(0, Math.floor(Number(capacityBySlot[slot]) || 0)),
    ),
  )
}

export function targetLayerRemaining(input: {
  fallbackRemaining: number
  duration: string | null | undefined
  eventDate: string | null | undefined
  components: readonly {
    day_slot: string
    quantity_remaining: number
    units_per_package?: number
  }[]
}): number {
  const fallback = Math.max(0, Math.floor(Number(input.fallbackRemaining) || 0))
  const slots = costDaySlotsForDuration(input.duration, input.eventDate).map((slot) =>
    slot.replace(/_only$/, ""),
  )
  if (slots.length === 0) return fallback
  const required = slots.map((slot) =>
    input.components.find((component) => component.day_slot === slot),
  )
  if (!required.every(Boolean)) return fallback
  return Math.min(
    ...required.map((component) =>
      Math.max(
        0,
        Math.floor(
          (Number(component?.quantity_remaining) || 0) /
            Math.max(1, Math.floor(Number(component?.units_per_package) || 1)),
        ),
      ),
    ),
  )
}

function positiveFinite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Normalizes positive values to exact fixed-scale weights. The final item gets
 * the integer remainder, preventing floating-point drift from losing cost.
 */
export function normalizeDayValues<T extends string>(
  orderedValues: readonly { key: T; value: number }[],
): Record<T, number> {
  if (orderedValues.length === 0) return {} as Record<T, number>
  const total = orderedValues.reduce((sum, item) => sum + item.value, 0)
  if (!Number.isFinite(total) || total <= 0 || orderedValues.some((item) => !positiveFinite(item.value))) {
    throw new Error("All values must be positive finite numbers.")
  }

  const apportioned = orderedValues.map((item, index) => {
    const rawUnits = (item.value / total) * WEIGHT_SCALE
    const units = Math.floor(rawUnits)
    return { item, index, units, fraction: rawUnits - units }
  })
  let remainder = WEIGHT_SCALE - apportioned.reduce((sum, row) => sum + row.units, 0)
  for (const row of [...apportioned].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  )) {
    if (remainder <= 0) break
    row.units += 1
    remainder -= 1
  }
  const output = {} as Record<T, number>
  for (const row of apportioned) output[row.item.key] = row.units / WEIGHT_SCALE
  return output
}

export function deriveTradePriceDayWeights(input: {
  sourceDuration: string | null | undefined
  eventDate: string | null | undefined
  members: readonly DayPriceMember[]
}): DerivedDayWeights {
  const days = costDaySlotsForDuration(input.sourceDuration, input.eventDate)
  const memberByDay = new Map<CostDaySlot, DayPriceMember>()
  for (const member of input.members) {
    const duration = member.duration?.trim()
    if (isCostDaySlot(duration) && !memberByDay.has(duration)) {
      memberByDay.set(duration, member)
    }
  }

  const missingDays = days.filter((day) => {
    const member = memberByDay.get(day)
    return !member || positiveFinite(member.tradePrice) == null
  })
  if (missingDays.length > 0) {
    return {
      status: "setup_required",
      missingDays,
      rows: days.map((day) => {
        const member = memberByDay.get(day)
        return {
          day,
          packageId: member?.packageId ?? null,
          tradePrice: positiveFinite(member?.tradePrice),
          weight: null,
        }
      }),
    }
  }

  const weights = normalizeDayValues(
    days.map((day) => ({ key: day, value: memberByDay.get(day)!.tradePrice! })),
  )
  return {
    status: "derived",
    missingDays: [],
    rows: days.map((day) => {
      const member = memberByDay.get(day)!
      return {
        day,
        packageId: member.packageId,
        tradePrice: member.tradePrice,
        weight: weights[day],
      }
    }),
  }
}

function decimalToScaledInteger(value: string | number, scaleDigits: number): number | null {
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fraction = ""] = text.split(".")
  if (fraction.length > scaleDigits) return null
  const scale = 10 ** scaleDigits
  const result = Number(whole) * scale + Number(fraction.padEnd(scaleDigits, "0"))
  return Number.isSafeInteger(result) ? result : null
}

/**
 * Validates group-level manual percentages without floating-point tolerance.
 * Values must be non-negative, include every required day, and total exactly 100%.
 */
export function validateManualDayPercentages(
  days: readonly CostDaySlot[],
  percentages: Partial<Record<CostDaySlot, string | number>>,
): ManualWeightValidation {
  if (days.length === 0) return { ok: false, message: "No day slots are available for this package." }
  const uniqueDays = [...new Set(days)]
  if (uniqueDays.length !== days.length) {
    return { ok: false, message: "Each included day must appear exactly once." }
  }

  const scaled = new Map<CostDaySlot, number>()
  for (const day of days) {
    const raw = percentages[day]
    if (raw == null || String(raw).trim() === "") {
      return { ok: false, message: `Enter a percentage for ${dayLabel(day)}.` }
    }
    const value = decimalToScaledInteger(raw, 4)
    if (value == null || value <= 0 || value > 100 * PERCENT_SCALE / 100) {
      return { ok: false, message: `${dayLabel(day)} must be greater than 0% and no more than 100%.` }
    }
    scaled.set(day, value)
  }

  const expected = 100 * (PERCENT_SCALE / 100)
  const total = [...scaled.values()].reduce((sum, value) => sum + value, 0)
  if (total !== expected) {
    return {
      ok: false,
      message: `Manual percentages must total exactly 100% (currently ${(total / (PERCENT_SCALE / 100)).toFixed(4).replace(/\.?0+$/, "")}%).`,
    }
  }

  const weights = {} as Record<CostDaySlot, number>
  for (const day of days) weights[day] = scaled.get(day)! / expected
  return { ok: true, weights }
}

/** Splits an amount at fixed decimal precision and assigns rounding remainder to the last day. */
export function allocateCostByDay(
  unitCost: number,
  orderedWeights: readonly { day: CostDaySlot; weight: number }[],
  decimalPlaces = 2,
): Record<CostDaySlot, number> {
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Unit cost must be non-negative.")
  if (orderedWeights.length === 0) return {} as Record<CostDaySlot, number>
  const scaledWeightTotal = orderedWeights.reduce((sum, row) => {
    if (!Number.isFinite(row.weight) || row.weight < 0) {
      throw new Error("Day weights must be non-negative finite numbers.")
    }
    return sum + Math.round(row.weight * WEIGHT_SCALE)
  }, 0)
  if (scaledWeightTotal !== WEIGHT_SCALE) {
    throw new Error("Day weights must total exactly 1.")
  }
  const scale = 10 ** decimalPlaces
  const totalUnits = Math.round(unitCost * scale)
  const output = {} as Record<CostDaySlot, number>
  let allocated = 0
  orderedWeights.forEach((row, index) => {
    const units =
      index === orderedWeights.length - 1
        ? totalUnits - allocated
        : Math.round(totalUnits * row.weight)
    allocated += units
    output[row.day] = units / scale
  })
  return output
}

export function dayLabel(day: CostDaySlot): string {
  switch (day) {
    case "thursday_only":
      return "Thursday"
    case "friday_only":
      return "Friday"
    case "saturday_only":
      return "Saturday"
    case "sunday_only":
      return "Sunday"
  }
}
