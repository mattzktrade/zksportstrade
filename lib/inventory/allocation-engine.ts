export type AllocationLayer = {
  id: string
  supplierId: string
  available: number
  receivedAt: string | null
}

export type AllocationParty = {
  id: string
  quantity: number
  locked: boolean
  current: Array<{ layerId: string; quantity: number }>
}

export type PlannedAllocation = {
  partyId: string
  takes: Array<{ layerId: string; supplierId: string; quantity: number }>
  split: boolean
}

export type AllocationPlan =
  | { ok: true; allocations: PlannedAllocation[] }
  | { ok: false; shortage: number }

const SEARCH_NODE_LIMIT = 80_000

type MutableLayer = AllocationLayer & { available: number }

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function receivedTime(value: string | null): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function sortFifo<T extends { id: string; receivedAt: string | null }>(layers: T[]): T[] {
  return [...layers].sort(
    (a, b) => receivedTime(a.receivedAt) - receivedTime(b.receivedAt) || a.id.localeCompare(b.id),
  )
}

function cloneLayers(layers: readonly MutableLayer[]): MutableLayer[] {
  return layers.map((layer) => ({ ...layer }))
}

function supplierRemaining(layers: readonly MutableLayer[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const layer of layers) {
    if (layer.available <= 0) continue
    totals.set(layer.supplierId, (totals.get(layer.supplierId) ?? 0) + layer.available)
  }
  return totals
}

function currentSupplierIds(
  party: AllocationParty,
  byId: ReadonlyMap<string, MutableLayer>,
): Set<string> {
  const ids = new Set<string>()
  for (const take of party.current) {
    const supplierId = byId.get(take.layerId)?.supplierId
    if (supplierId) ids.add(supplierId)
  }
  return ids
}

function coveringSuppliers(
  remaining: ReadonlyMap<string, number>,
  quantity: number,
  prefer: ReadonlySet<string>,
): string[] {
  return [...remaining.entries()]
    .filter(([, available]) => available >= quantity)
    .sort((a, b) => {
      const aPreferred = prefer.has(a[0]) ? 1 : 0
      const bPreferred = prefer.has(b[0]) ? 1 : 0
      if (aPreferred !== bPreferred) return bPreferred - aPreferred
      if (a[1] !== b[1]) return a[1] - b[1]
      return a[0].localeCompare(b[0])
    })
    .map(([supplierId]) => supplierId)
}

function takeFromSupplier(
  layers: MutableLayer[],
  supplierId: string,
  quantity: number,
  requireFull: boolean,
): PlannedAllocation["takes"] {
  const takes: PlannedAllocation["takes"] = []
  let left = quantity
  for (const layer of layers) {
    if (left <= 0) break
    if (layer.supplierId !== supplierId || layer.available <= 0) continue
    const take = Math.min(layer.available, left)
    layer.available -= take
    left -= take
    takes.push({ layerId: layer.id, supplierId, quantity: take })
  }
  if (left > 0 && requireFull) {
    for (const take of takes) {
      const layer = layers.find((row) => row.id === take.layerId)
      if (layer) layer.available += take.quantity
    }
    return []
  }
  return takes
}

function splitAcrossSuppliers(
  layers: MutableLayer[],
  quantity: number,
): PlannedAllocation["takes"] | null {
  const remaining = [...supplierRemaining(layers).entries()]
    .filter(([, available]) => available > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const takes: PlannedAllocation["takes"] = []
  let left = quantity
  for (const [supplierId] of remaining) {
    if (left <= 0) break
    const supplierTakes = takeFromSupplier(layers, supplierId, left, false)
    if (supplierTakes.length === 0) continue
    const taken = supplierTakes.reduce((sum, take) => sum + take.quantity, 0)
    takes.push(...supplierTakes)
    left -= taken
  }
  return left === 0 ? takes : null
}

/**
 * Keep every unlocked party on one supplier whenever purchased stock allows it,
 * including by rearranging earlier mutable assignments. Split a party across the
 * fewest leftover suppliers only when no reshuffle can keep it whole.
 * Later parties in the input (newer deals) win ties so a new order stays whole
 * if an older order can be the one that splits.
 */
export function planInventoryAllocations(
  inputLayers: readonly AllocationLayer[],
  inputParties: readonly AllocationParty[],
): AllocationPlan {
  const layers = sortFifo(
    inputLayers.map((layer) => ({ ...layer, available: whole(layer.available) })),
  )
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  const lockedAllocations: PlannedAllocation[] = []

  for (const party of inputParties.filter((row) => row.locked)) {
    const takes: PlannedAllocation["takes"] = []
    let assigned = 0
    for (const current of party.current) {
      const layer = byId.get(current.layerId)
      const quantity = whole(current.quantity)
      if (!layer || quantity <= 0 || quantity > layer.available) {
        return { ok: false, shortage: Math.max(1, whole(party.quantity) - assigned) }
      }
      layer.available -= quantity
      assigned += quantity
      takes.push({ layerId: layer.id, supplierId: layer.supplierId, quantity })
    }
    if (assigned !== whole(party.quantity)) {
      return { ok: false, shortage: Math.max(1, whole(party.quantity) - assigned) }
    }
    lockedAllocations.push({
      partyId: party.id,
      takes,
      split: new Set(takes.map((take) => take.supplierId)).size > 1,
    })
  }

  const flexible = inputParties
    .map((party, inputIndex) => ({ party, inputIndex }))
    .filter((row) => !row.party.locked)
  const demand = flexible.reduce((sum, row) => sum + whole(row.party.quantity), 0)
  const capacity = layers.reduce((sum, layer) => sum + layer.available, 0)
  if (demand > capacity) {
    return { ok: false, shortage: demand - capacity }
  }

  const startRemaining = supplierRemaining(layers)
  const coveringCount = (quantity: number) =>
    [...startRemaining.values()].filter((available) => available >= quantity).length
  const searchOrder = flexible
    .map((row, flexibleIndex) => ({ row, flexibleIndex }))
    .sort((a, b) => {
      const aQty = whole(a.row.party.quantity)
      const bQty = whole(b.row.party.quantity)
      const aCover = coveringCount(aQty)
      const bCover = coveringCount(bQty)
      if (aCover !== bCover) return aCover - bCover
      if (aQty !== bQty) return bQty - aQty
      return a.row.inputIndex - b.row.inputIndex || a.row.party.id.localeCompare(b.row.party.id)
    })
    .map((row) => row.flexibleIndex)

  const assignment: (string | null)[] = flexible.map(() => null)
  let nodes = 0
  let bestAssigned = -1
  let bestNewest = -1
  let bestAssignment: (string | null)[] = flexible.map(() => null)

  const search = (
    depth: number,
    remaining: Map<string, number>,
    assignedCount: number,
    newestScore: number,
  ) => {
    if (nodes > SEARCH_NODE_LIMIT) return
    nodes += 1
    const remainingParties = searchOrder.length - depth
    if (assignedCount + remainingParties < bestAssigned) return
    if (depth === searchOrder.length) {
      if (
        assignedCount > bestAssigned ||
        (assignedCount === bestAssigned && newestScore > bestNewest)
      ) {
        bestAssigned = assignedCount
        bestNewest = newestScore
        bestAssignment = assignment.slice()
      }
      return
    }

    const flexibleIndex = searchOrder[depth] ?? 0
    const { party, inputIndex } = flexible[flexibleIndex] ?? {
      party: { id: "", quantity: 0, locked: false, current: [] },
      inputIndex: 0,
    }
    const quantity = whole(party.quantity)
    if (quantity <= 0) {
      assignment[flexibleIndex] = null
      search(depth + 1, remaining, assignedCount + 1, newestScore + inputIndex + 1)
      return
    }

    const options = coveringSuppliers(
      remaining,
      quantity,
      currentSupplierIds(party, byId),
    )
    for (const supplierId of options) {
      remaining.set(supplierId, (remaining.get(supplierId) ?? 0) - quantity)
      assignment[flexibleIndex] = supplierId
      search(
        depth + 1,
        remaining,
        assignedCount + 1,
        newestScore + inputIndex + 1,
      )
      assignment[flexibleIndex] = null
      remaining.set(supplierId, (remaining.get(supplierId) ?? 0) + quantity)
      if (bestAssigned === flexible.length) return
    }

    if (assignedCount + remainingParties - 1 >= bestAssigned) {
      assignment[flexibleIndex] = null
      search(depth + 1, remaining, assignedCount, newestScore)
    }
  }

  search(0, new Map(startRemaining), 0, 0)

  if (bestAssigned < 0) {
    const greedyRemaining = new Map(startRemaining)
    for (const flexibleIndex of searchOrder) {
      const party = flexible[flexibleIndex]?.party
      if (!party) continue
      const quantity = whole(party.quantity)
      if (quantity <= 0) {
        bestAssignment[flexibleIndex] = null
        continue
      }
      const supplierId = coveringSuppliers(
        greedyRemaining,
        quantity,
        currentSupplierIds(party, byId),
      )[0]
      if (supplierId) {
        bestAssignment[flexibleIndex] = supplierId
        greedyRemaining.set(supplierId, (greedyRemaining.get(supplierId) ?? 0) - quantity)
      } else {
        bestAssignment[flexibleIndex] = null
      }
    }
  }

  const working = cloneLayers(layers)
  const flexibleAllocations: PlannedAllocation[] = flexible.map(({ party }) => ({
    partyId: party.id,
    takes: [],
    split: false,
  }))

  for (let index = 0; index < flexible.length; index += 1) {
    const supplierId = bestAssignment[index]
    if (!supplierId) continue
    const party = flexible[index]?.party
    if (!party) continue
    const takes = takeFromSupplier(working, supplierId, whole(party.quantity), true)
    if (takes.length === 0) {
      return { ok: false, shortage: whole(party.quantity) }
    }
    flexibleAllocations[index] = {
      partyId: party.id,
      takes,
      split: false,
    }
  }

  for (let index = 0; index < flexible.length; index += 1) {
    if (bestAssignment[index]) continue
    const party = flexible[index]?.party
    if (!party) continue
    const quantity = whole(party.quantity)
    if (quantity <= 0) {
      flexibleAllocations[index] = { partyId: party.id, takes: [], split: false }
      continue
    }
    const takes = splitAcrossSuppliers(working, quantity)
    if (!takes) {
      return { ok: false, shortage: quantity }
    }
    flexibleAllocations[index] = {
      partyId: party.id,
      takes,
      split: new Set(takes.map((take) => take.supplierId)).size > 1,
    }
  }

  const byPartyId = new Map<string, PlannedAllocation>([
    ...lockedAllocations.map((row) => [row.partyId, row] as const),
    ...flexibleAllocations.map((row) => [row.partyId, row] as const),
  ])

  return {
    ok: true,
    allocations: inputParties.map(
      (party) =>
        byPartyId.get(party.id) ?? {
          partyId: party.id,
          takes: [],
          split: false,
        },
    ),
  }
}
