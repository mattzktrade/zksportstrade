/**
 * Which signed sales a shared weekend can actually cover.
 *
 * A 3-day place and a Friday place draw the same purchased seats, but only on
 * the days each sale includes. First-come allocation can leave the 3-day sale
 * uncovered when Friday was filled first, even though Friday is the only day
 * over the purchase. This planner keeps longer sales whenever the day totals
 * allow, and leaves the shortage on the single-day sales for the day that is
 * actually over.
 *
 * The database copy of this decision lives in
 * inventory_rebalance_linked_day_coverage.
 */

export type LinkedDaySlotUse = {
  slot: string
  /** Component units one sold place consumes on this day. */
  units: number
}

export type LinkedDayCoverageLine = {
  id: string
  quantity: number
  slots: readonly LinkedDaySlotUse[]
  /** Smaller values are older and are filled first among the same days. */
  olderFirst: number
}

export type LinkedDayCoverage = {
  id: string
  covered: number
}

type WorkingLine = LinkedDayCoverageLine & {
  covered: number
  dayCount: number
  slotKey: string
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function unitsOf(slot: LinkedDaySlotUse): number {
  return Math.max(1, whole(slot.units))
}

function slotKey(line: LinkedDayCoverageLine): string {
  return [...line.slots].map((slot) => slot.slot).sort().join("|")
}

function dayCount(line: LinkedDayCoverageLine): number {
  return new Set(line.slots.map((slot) => slot.slot)).size
}

function cloneCapacity(capacity: Readonly<Record<string, number>>): Map<string, number> {
  const next = new Map<string, number>()
  for (const [slot, qty] of Object.entries(capacity)) {
    next.set(slot, whole(qty))
  }
  return next
}

function placesThatFit(line: LinkedDayCoverageLine, capacity: ReadonlyMap<string, number>): number {
  let take = whole(line.quantity)
  for (const slot of line.slots) {
    const have = capacity.get(slot.slot) ?? 0
    take = Math.min(take, Math.floor(have / unitsOf(slot)))
  }
  return Math.max(0, take)
}

function addConsumption(
  capacity: Map<string, number>,
  line: LinkedDayCoverageLine,
  places: number,
  direction: 1 | -1,
) {
  for (const slot of line.slots) {
    const next = (capacity.get(slot.slot) ?? 0) - direction * places * unitsOf(slot)
    capacity.set(slot.slot, next)
  }
}

function consumptionFits(
  lines: readonly WorkingLine[],
  original: ReadonlyMap<string, number>,
): boolean {
  const used = new Map<string, number>()
  for (const line of lines) {
    for (const slot of line.slots) {
      used.set(slot.slot, (used.get(slot.slot) ?? 0) + line.covered * unitsOf(slot))
    }
  }
  for (const [slot, qty] of used) {
    if (qty > (original.get(slot) ?? 0)) return false
  }
  return true
}

/**
 * Cover as many places as the purchased days allow.
 * Longer stays (3-day, then 2-day) are filled before single days.
 * Within the same days, older sales are filled first.
 * When the places left over equal one whole sale, that whole sale is the one
 * left uncovered — the newest sale of that size — instead of splitting a
 * larger booking.
 */
export function planLinkedDayCoverage(
  lines: readonly LinkedDayCoverageLine[],
  capacity: Readonly<Record<string, number>>,
): LinkedDayCoverage[] {
  const original = cloneCapacity(capacity)
  const remaining = cloneCapacity(capacity)
  const working: WorkingLine[] = lines
    .filter((line) => line.slots.length > 0)
    .map((line) => ({
      ...line,
      quantity: whole(line.quantity),
      covered: 0,
      dayCount: dayCount(line),
      slotKey: slotKey(line),
    }))

  working.sort(
    (a, b) =>
      b.dayCount - a.dayCount ||
      a.olderFirst - b.olderFirst ||
      a.id.localeCompare(b.id),
  )

  for (const line of working) {
    const take = placesThatFit(line, remaining)
    line.covered = take
    addConsumption(remaining, line, take, 1)
  }

  const slotKeys = [...new Set(working.map((line) => line.slotKey))]
  for (const key of slotKeys) {
    const group = working.filter((line) => line.slotKey === key)
    const excess = group.reduce((sum, line) => sum + (line.quantity - line.covered), 0)
    if (excess <= 0) continue
    const candidates = group
      .filter((line) => line.quantity === excess)
      .sort((a, b) => b.olderFirst - a.olderFirst || b.id.localeCompare(a.id))
    const chosen = candidates[0]
    if (!chosen) continue
    const snapshot = new Map(group.map((line) => [line.id, line.covered]))
    for (const line of group) {
      line.covered = line.id === chosen.id ? 0 : line.quantity
    }
    if (!consumptionFits(working, original)) {
      for (const line of group) line.covered = snapshot.get(line.id) ?? 0
    }
  }

  return working.map((line) => ({ id: line.id, covered: line.covered }))
}
