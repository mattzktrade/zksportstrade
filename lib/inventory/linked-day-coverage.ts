import { costDaySlotsForDuration } from "./day-cost-allocation"
import { compareOldestSaleFirst } from "./sale-fill-order"

/**
 * Which signed sales a shared weekend can actually cover.
 *
 * A 3-day place and a Friday place draw the same purchased seats, but only on
 * the days each sale includes. First-come allocation can leave the 3-day sale
 * uncovered when Friday was filled first, even though Friday is the only day
 * over the purchase. This planner keeps longer sales whenever the day totals
 * allow, and leaves the shortage on the newest deals (last added).
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
  /** Smaller values are older (filled first among the same days). */
  olderFirst: number
}

export type LinkedDayCoverage = {
  id: string
  covered: number
}

type WorkingLine = LinkedDayCoverageLine & {
  covered: number
  dayCount: number
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function unitsOf(slot: LinkedDaySlotUse): number {
  return Math.max(1, whole(slot.units))
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

/**
 * Cover as many places as the purchased days allow.
 * Longer stays (3-day, then 2-day) are filled before single days.
 * Within the same days, older deals keep seats.
 * The leftover shortage sits on the newest (last-added) deals.
 */
export function planLinkedDayCoverage(
  lines: readonly LinkedDayCoverageLine[],
  capacity: Readonly<Record<string, number>>,
): LinkedDayCoverage[] {
  const remaining = cloneCapacity(capacity)
  const working: WorkingLine[] = lines
    .filter((line) => line.slots.length > 0)
    .map((line) => ({
      ...line,
      quantity: whole(line.quantity),
      covered: 0,
      dayCount: dayCount(line),
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

  return working.map((line) => ({ id: line.id, covered: line.covered }))
}

export type LinkedDayCoverageSale = {
  id: string
  packageId: string
  quantity: number
  createdAt: string
  reference?: string | null
  sortOrder?: number
}

/**
 * Covered purchased places for each signed owned sale on a shared weekend.
 * Longer stays keep seats. Extra places sit on the newest (last-added) deals.
 */
export function planOwnedLinkedDayCoverage(input: {
  stock: number
  eventDate?: string | null
  packages: readonly { id: string; duration: string | null }[]
  lines: readonly LinkedDayCoverageSale[]
}): Map<string, number> {
  const durationByPackage = new Map(input.packages.map((pkg) => [pkg.id, pkg.duration ?? null]))
  const ordered = [...input.lines].sort(
    (left, right) =>
      compareOldestSaleFirst(left, right) ||
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0),
  )
  const plannerLines: LinkedDayCoverageLine[] = []
  for (const [index, line] of ordered.entries()) {
    const slots = costDaySlotsForDuration(
      durationByPackage.get(line.packageId),
      input.eventDate,
    ).map((slot) => ({ slot: slot.replace(/_only$/, ""), units: 1 }))
    if (slots.length === 0) continue
    plannerLines.push({
      id: line.id,
      quantity: whole(line.quantity),
      olderFirst: index + 1,
      slots,
    })
  }
  const capacity: Record<string, number> = {}
  const purchased = whole(input.stock)
  for (const line of plannerLines) {
    for (const slot of line.slots) capacity[slot.slot] = purchased
  }
  return new Map(
    planLinkedDayCoverage(plannerLines, capacity).map((row) => [row.id, row.covered]),
  )
}

export type LinkedDayPlanLine = LinkedDayCoverageSale & {
  inventoryGroupId: string | null
  standalone?: boolean
  duration: string | null
  eventDate: string | null
  sourcingMode?: string | null
}

/** Places on shared-weekend sales that the purchased days cannot cover. */
export function uncoveredQuantitiesFromLinkedDayPlan(
  lines: readonly LinkedDayPlanLine[],
  stockByGroup: ReadonlyMap<string, number>,
  linkedGroupIds?: ReadonlySet<string>,
): { linkedLineIds: Set<string>; uncovered: Map<string, number> } {
  const groups = new Map<string, LinkedDayPlanLine[]>()
  for (const line of lines) {
    if ((line.sourcingMode ?? "owned") !== "owned") continue
    const groupId = line.inventoryGroupId?.trim()
    if (!groupId || line.standalone) continue
    const list = groups.get(groupId) ?? []
    list.push(line)
    groups.set(groupId, list)
  }
  const linkedLineIds = new Set<string>()
  const uncovered = new Map<string, number>()
  for (const [groupId, groupLines] of groups) {
    if (groupLines.length === 0) continue
    const packageIds = new Set(groupLines.map((line) => line.packageId))
    const linkedGroup = linkedGroupIds?.has(groupId) === true || packageIds.size >= 2
    if (!linkedGroup) continue
    const stock = stockByGroup.get(groupId) ?? 0
    if (stock <= 0) continue
    for (const line of groupLines) linkedLineIds.add(line.id)
    const packages = [
      ...new Map(
        groupLines.map((line) => [line.packageId, { id: line.packageId, duration: line.duration }]),
      ).values(),
    ]
    const eventDate = groupLines.find((line) => line.eventDate)?.eventDate ?? null
    const covered = planOwnedLinkedDayCoverage({
      stock,
      eventDate,
      packages,
      lines: groupLines,
    })
    for (const line of groupLines) {
      const short = whole(line.quantity) - (covered.get(line.id) ?? 0)
      if (short > 0) uncovered.set(line.id, short)
    }
  }
  return { linkedLineIds, uncovered }
}
