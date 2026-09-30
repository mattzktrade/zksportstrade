import { compareOldestSaleFirst } from "@/lib/inventory/sale-fill-order"

export type SupplierAssignmentPool = {
  key: string
  name: string
  purchased: number
  targetCapacity: number
  capacityBySlot: Readonly<Record<string, number>>
}

export type SupplierAssignmentDemand = {
  id: string
  /** Lines that share a deal stay on one supplier whenever that supplier can take the whole order. */
  dealId?: string | null
  dealReference: string | null
  createdAt: string
  quantity: number
  coverable: number
  slots: readonly string[]
  preferredKey?: string | null
  pinnedKey?: string | null
}

/** Stock already spoken for (portal orders without a signed deal line in this list). */
export type SupplierAssignmentHold = {
  key: string
  slots: readonly string[]
  quantity: number
}

export type SupplierAssignmentSlice = {
  key: string
  name: string
  quantity: number
}

export type SupplierLineAssignment = {
  id: string
  slices: SupplierAssignmentSlice[]
  assigned: number
  unassigned: number
  needStock: boolean
  singleKey: string | null
}

export type SupplierAssignmentPlan = {
  byLine: Map<string, SupplierLineAssignment>
  assignedByPool: Record<string, number>
  remainingByPool: Record<string, number>
}

type WorkingLine = {
  demand: SupplierAssignmentDemand
  quantity: number
  need: number
  slots: readonly string[]
  slices: SupplierAssignmentSlice[]
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

export function compareSupplierDemandOrder(
  left: Pick<SupplierAssignmentDemand, "id" | "dealReference" | "createdAt">,
  right: Pick<SupplierAssignmentDemand, "id" | "dealReference" | "createdAt">,
): number {
  return compareOldestSaleFirst(left, right)
}

function slotCapacity(pool: SupplierAssignmentPool, slot: string): number {
  const fromSlot = pool.capacityBySlot[slot]
  if (fromSlot != null) return whole(fromSlot)
  return whole(pool.targetCapacity || pool.purchased)
}

function cloneRemaining(
  pools: readonly SupplierAssignmentPool[],
  slots: readonly string[],
): Map<string, Map<string, number>> {
  const remaining = new Map<string, Map<string, number>>()
  const neededSlots = slots.length > 0 ? slots : ["unit"]
  for (const pool of pools) {
    const bySlot = new Map<string, number>()
    for (const slot of neededSlots) {
      bySlot.set(slot, slotCapacity(pool, slot))
    }
    remaining.set(pool.key, bySlot)
  }
  return remaining
}

function cloneRemainingMap(
  remaining: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
  const next = new Map<string, Map<string, number>>()
  for (const [key, bySlot] of remaining) {
    next.set(key, new Map(bySlot))
  }
  return next
}

function headroom(
  remaining: Map<string, Map<string, number>>,
  key: string,
  slots: readonly string[],
): number {
  const bySlot = remaining.get(key)
  if (!bySlot || slots.length === 0) return 0
  return Math.min(...slots.map((slot) => Math.max(0, bySlot.get(slot) ?? 0)))
}

function consume(
  remaining: Map<string, Map<string, number>>,
  key: string,
  slots: readonly string[],
  quantity: number,
) {
  const take = whole(quantity)
  if (take <= 0) return
  const bySlot = remaining.get(key)
  if (!bySlot) return
  for (const slot of slots) {
    bySlot.set(slot, Math.max(0, (bySlot.get(slot) ?? 0) - take))
  }
}

function emptyAssignment(id: string, unassigned: number): SupplierLineAssignment {
  return {
    id,
    slices: [],
    assigned: 0,
    unassigned,
    needStock: unassigned > 0,
    singleKey: null,
  }
}

function toAssignment(
  id: string,
  quantity: number,
  slices: SupplierAssignmentSlice[],
): SupplierLineAssignment {
  const merged = new Map<string, SupplierAssignmentSlice>()
  for (const slice of slices) {
    if (slice.quantity <= 0) continue
    const current = merged.get(slice.key)
    if (current) current.quantity += slice.quantity
    else merged.set(slice.key, { ...slice })
  }
  const mergedSlices = [...merged.values()]
  const assigned = mergedSlices.reduce((sum, slice) => sum + slice.quantity, 0)
  const unassigned = Math.max(0, quantity - assigned)
  const keys = [...new Set(mergedSlices.map((slice) => slice.key))]
  return {
    id,
    slices: mergedSlices,
    assigned,
    unassigned,
    needStock: unassigned > 0,
    singleKey: unassigned === 0 && keys.length === 1 ? keys[0] : null,
  }
}

function groupKey(demand: SupplierAssignmentDemand): string {
  const dealId = demand.dealId?.trim()
  return dealId || demand.id
}

function canTakeAll(
  remaining: Map<string, Map<string, number>>,
  key: string,
  items: readonly { slots: readonly string[]; need: number }[],
): boolean {
  if (!remaining.has(key)) return false
  const snap = cloneRemainingMap(remaining)
  for (const item of items) {
    const take = whole(item.need)
    if (take <= 0) continue
    if (headroom(snap, key, item.slots) < take) return false
    consume(snap, key, item.slots, take)
  }
  return true
}

function leftoverAfterTaking(
  remaining: Map<string, Map<string, number>>,
  key: string,
  items: readonly { slots: readonly string[]; need: number }[],
): number {
  const snap = cloneRemainingMap(remaining)
  const slots = [...new Set(items.flatMap((item) => [...item.slots]))]
  for (const item of items) consume(snap, key, item.slots, item.need)
  if (slots.length === 0) return 0
  return Math.min(...slots.map((slot) => Math.max(0, snap.get(key)?.get(slot) ?? 0)))
}

function bestWholeSupplier(
  remaining: Map<string, Map<string, number>>,
  pools: readonly SupplierAssignmentPool[],
  items: readonly { slots: readonly string[]; need: number }[],
  preferKey: string | null,
): string | null {
  const need = items.reduce((sum, item) => sum + whole(item.need), 0)
  if (need <= 0) return null
  if (preferKey && canTakeAll(remaining, preferKey, items)) return preferKey
  const fits = pools
    .filter((pool) => canTakeAll(remaining, pool.key, items))
    .sort(
      (left, right) =>
        leftoverAfterTaking(remaining, left.key, items) -
          leftoverAfterTaking(remaining, right.key, items) ||
        whole(left.targetCapacity || left.purchased) -
          whole(right.targetCapacity || right.purchased) ||
        left.name.localeCompare(right.name) ||
        left.key.localeCompare(right.key),
    )
  return fits[0]?.key ?? null
}

function fillFromMany(
  remaining: Map<string, Map<string, number>>,
  pools: readonly SupplierAssignmentPool[],
  slots: readonly string[],
  need: number,
  nameByKey: ReadonlyMap<string, string>,
): SupplierAssignmentSlice[] {
  const slices: SupplierAssignmentSlice[] = []
  let left = whole(need)
  while (left > 0) {
    const ranked = pools
      .map((pool) => ({
        key: pool.key,
        room: headroom(remaining, pool.key, slots),
        name: pool.name,
      }))
      .filter((row) => row.room > 0)
      .sort(
        (leftRow, rightRow) =>
          rightRow.room - leftRow.room || leftRow.name.localeCompare(rightRow.name),
      )
    const pick = ranked[0]
    if (!pick) break
    const take = Math.min(left, pick.room)
    consume(remaining, pick.key, slots, take)
    slices.push({
      key: pick.key,
      name: nameByKey.get(pick.key) ?? pick.name,
      quantity: take,
    })
    left -= take
  }
  return slices
}

function applyHold(
  remaining: Map<string, Map<string, number>>,
  hold: SupplierAssignmentHold,
): number {
  const slots = hold.slots.length > 0 ? hold.slots : ["unit"]
  const take = Math.min(whole(hold.quantity), headroom(remaining, hold.key, slots))
  if (take > 0) consume(remaining, hold.key, slots, take)
  return take
}

function assignLinesToSupplier(
  remaining: Map<string, Map<string, number>>,
  rows: readonly WorkingLine[],
  key: string,
  name: string,
) {
  for (const row of rows) {
    if (row.need <= 0) continue
    consume(remaining, key, row.slots, row.need)
    row.slices.push({ key, name, quantity: row.need })
    row.need = 0
  }
}

function takeFromSupplier(
  remaining: Map<string, Map<string, number>>,
  rows: readonly WorkingLine[],
  key: string,
  name: string,
) {
  const ordered = [...rows]
    .filter((row) => row.need > 0)
    .sort(
      (left, right) =>
        right.need - left.need || left.demand.id.localeCompare(right.demand.id),
    )
  for (const row of ordered) {
    const take = Math.min(row.need, headroom(remaining, key, row.slots))
    if (take <= 0) continue
    consume(remaining, key, row.slots, take)
    row.slices.push({ key, name, quantity: take })
    row.need -= take
  }
}

function agreedKey(
  rows: readonly WorkingLine[],
  pick: (row: WorkingLine) => string | null | undefined,
  nameByKey: ReadonlyMap<string, string>,
): string | null {
  const keys = new Set(
    rows
      .map((row) => pick(row)?.trim() || "")
      .filter((key) => key && nameByKey.has(key)),
  )
  return keys.size === 1 ? [...keys][0] : null
}

function assignDealGroup(
  remaining: Map<string, Map<string, number>>,
  pools: readonly SupplierAssignmentPool[],
  nameByKey: ReadonlyMap<string, string>,
  lines: readonly SupplierAssignmentDemand[],
  byLine: Map<string, SupplierLineAssignment>,
) {
  const work: WorkingLine[] = lines.map((demand) => {
    const quantity = whole(demand.quantity)
    const coverable = Math.min(quantity, whole(demand.coverable))
    const slots = demand.slots.length > 0 ? demand.slots : ["unit"]
    return {
      demand,
      quantity,
      need: coverable,
      slots,
      slices: [],
    }
  })

  if (pools.length === 0) {
    for (const row of work) {
      byLine.set(row.demand.id, emptyAssignment(row.demand.id, row.quantity))
    }
    return
  }

  for (const row of work) {
    if (row.need <= 0) {
      byLine.set(row.demand.id, emptyAssignment(row.demand.id, row.quantity))
      row.need = 0
    }
  }

  const pending = () => work.filter((row) => row.need > 0)
  const asItems = (rows: readonly WorkingLine[]) =>
    rows.map((row) => ({ slots: row.slots, need: row.need }))

  const dealPin = agreedKey(
    work.filter((row) => row.need > 0),
    (row) => row.demand.pinnedKey,
    nameByKey,
  )
  const mixedPins = new Set(
    pending()
      .map((row) => row.demand.pinnedKey?.trim() || "")
      .filter((key) => key && nameByKey.has(key)),
  )

  if (mixedPins.size > 1) {
    for (const row of pending()) {
      const pin = row.demand.pinnedKey?.trim() || null
      if (!pin || !nameByKey.has(pin)) continue
      takeFromSupplier(remaining, [row], pin, nameByKey.get(pin) ?? pin)
    }
  } else if (dealPin) {
    const open = pending()
    if (canTakeAll(remaining, dealPin, asItems(open))) {
      assignLinesToSupplier(remaining, open, dealPin, nameByKey.get(dealPin) ?? dealPin)
    } else {
      takeFromSupplier(remaining, open, dealPin, nameByKey.get(dealPin) ?? dealPin)
    }
  }

  const leftover = pending()
  if (leftover.length > 0) {
    const prefer = agreedKey(leftover, (row) => row.demand.preferredKey, nameByKey)
    const wholeKey = bestWholeSupplier(remaining, pools, asItems(leftover), prefer)
    if (wholeKey) {
      assignLinesToSupplier(remaining, leftover, wholeKey, nameByKey.get(wholeKey) ?? wholeKey)
    } else {
      const largestFirst = [...leftover].sort(
        (left, right) =>
          right.need - left.need || left.demand.id.localeCompare(right.demand.id),
      )
      for (const row of largestFirst) {
        if (row.need <= 0) continue
        const linePrefer = row.demand.preferredKey?.trim() || null
        const lineWhole = bestWholeSupplier(
          remaining,
          pools,
          [{ slots: row.slots, need: row.need }],
          linePrefer,
        )
        if (lineWhole) {
          assignLinesToSupplier(remaining, [row], lineWhole, nameByKey.get(lineWhole) ?? lineWhole)
        } else {
          row.slices.push(
            ...fillFromMany(remaining, pools, row.slots, row.need, nameByKey),
          )
          row.need = 0
        }
      }
    }
  }

  for (const row of work) {
    if (byLine.has(row.demand.id) && row.slices.length === 0) continue
    byLine.set(row.demand.id, toAssignment(row.demand.id, row.quantity, row.slices))
  }
}

/**
 * Assign purchased supplier stock to signed sales.
 *
 * Oldest sales are filled first (last-added take the shortage; DL is only a
 * tie-break). A deal stays on one supplier whenever that supplier still has
 * enough seats. Splits are a last resort. Leftover seats that cannot be
 * covered stay unassigned — pools never go negative.
 */
export function planSupplierAssignments(input: {
  pools: readonly SupplierAssignmentPool[]
  demands: readonly SupplierAssignmentDemand[]
  holds?: readonly SupplierAssignmentHold[]
}): SupplierAssignmentPlan {
  const pools = input.pools.filter((pool) => pool.key)
  const nameByKey = new Map(pools.map((pool) => [pool.key, pool.name]))
  const allSlots = [
    ...new Set([
      ...input.demands.flatMap((demand) => [...demand.slots]),
      ...(input.holds ?? []).flatMap((hold) => [...hold.slots]),
    ]),
  ]
  const remaining = cloneRemaining(pools, allSlots)
  const assignedByPool: Record<string, number> = {}
  for (const pool of pools) assignedByPool[pool.key] = 0

  for (const hold of input.holds ?? []) {
    if (!nameByKey.has(hold.key)) continue
    assignedByPool[hold.key] = (assignedByPool[hold.key] ?? 0) + applyHold(remaining, hold)
  }

  const groupOrder: string[] = []
  const groups = new Map<string, SupplierAssignmentDemand[]>()
  for (const demand of [...input.demands].sort(compareSupplierDemandOrder)) {
    const key = groupKey(demand)
    const current = groups.get(key)
    if (current) current.push(demand)
    else {
      groups.set(key, [demand])
      groupOrder.push(key)
    }
  }

  const byLine = new Map<string, SupplierLineAssignment>()
  for (const key of groupOrder) {
    assignDealGroup(remaining, pools, nameByKey, groups.get(key) ?? [], byLine)
  }

  for (const row of byLine.values()) {
    for (const slice of row.slices) {
      assignedByPool[slice.key] = (assignedByPool[slice.key] ?? 0) + slice.quantity
    }
  }

  const slots = allSlots.length > 0 ? allSlots : ["unit"]
  const remainingByPool: Record<string, number> = {}
  for (const pool of pools) {
    const bySlot = remaining.get(pool.key)
    remainingByPool[pool.key] = bySlot
      ? Math.min(...slots.map((slot) => Math.max(0, bySlot.get(slot) ?? 0)))
      : 0
  }

  return { byLine, assignedByPool, remainingByPool }
}

export function assignmentForLines(
  plan: SupplierAssignmentPlan,
  lineIds: readonly string[],
): SupplierLineAssignment {
  const slicesByKey = new Map<string, SupplierAssignmentSlice>()
  let assigned = 0
  let unassigned = 0
  for (const lineId of lineIds) {
    const row = plan.byLine.get(lineId)
    if (!row) continue
    assigned += row.assigned
    unassigned += row.unassigned
    for (const slice of row.slices) {
      const current = slicesByKey.get(slice.key)
      if (current) current.quantity += slice.quantity
      else slicesByKey.set(slice.key, { ...slice })
    }
  }
  const slices = [...slicesByKey.values()].sort(
    (left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name),
  )
  const keys = slices.map((slice) => slice.key)
  return {
    id: lineIds[0] ?? "",
    slices,
    assigned,
    unassigned,
    needStock: unassigned > 0,
    singleKey: unassigned === 0 && keys.length === 1 ? keys[0] : null,
  }
}
