export type SoldCostLayer = {
  id: string
  quantity: number
  quantity_remaining: number
  received_at: string | null
}

function layerBookedSold(
  layer: SoldCostLayer,
  consumptionsByLayer: ReadonlyMap<string, number>,
): number {
  const qty = Math.max(0, Math.floor(Number(layer.quantity) || 0))
  const remaining = Math.max(0, Math.floor(Number(layer.quantity_remaining) || 0))
  const consumed = consumptionsByLayer.get(layer.id)
  return consumed != null ? Math.max(0, consumed) : Math.max(0, qty - remaining)
}

export function allocateUnattributedSoldAcrossLayers(input: {
  layers: readonly SoldCostLayer[]
  bookedSoldByLayer: ReadonlyMap<string, number>
  totalPackageSold: number
}): Map<string, number> {
  const soldByLayer = new Map<string, number>()
  let bookedTotal = 0
  for (const layer of input.layers) {
    const booked = Math.max(0, Math.floor(input.bookedSoldByLayer.get(layer.id) ?? 0))
    soldByLayer.set(layer.id, booked)
    bookedTotal += booked
  }

  const totalPackageSold = Math.max(0, Math.floor(input.totalPackageSold))

  if (bookedTotal > totalPackageSold) {
    for (const layer of input.layers) soldByLayer.set(layer.id, 0)
    bookedTotal = 0
  }

  let remainingToAllocate = Math.max(0, totalPackageSold - bookedTotal)
  if (remainingToAllocate <= 0) return soldByLayer

  const ordered = [...input.layers].sort((a, b) => {
    const aTime = a.received_at ? new Date(a.received_at).getTime() : 0
    const bTime = b.received_at ? new Date(b.received_at).getTime() : 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })

  for (const layer of ordered) {
    if (remainingToAllocate <= 0) break
    const purchased = Math.max(0, Math.floor(Number(layer.quantity) || 0))
    const already = soldByLayer.get(layer.id) ?? 0
    const capacity = Math.max(0, purchased - already)
    if (capacity <= 0) continue
    const take = Math.min(capacity, remainingToAllocate)
    soldByLayer.set(layer.id, already + take)
    remainingToAllocate -= take
  }

  if (remainingToAllocate > 0 && ordered.length > 0) {
    const newest = ordered[ordered.length - 1]
    soldByLayer.set(newest.id, (soldByLayer.get(newest.id) ?? 0) + remainingToAllocate)
  }

  return soldByLayer
}

export function resolveSoldByCostLayer(input: {
  layers: readonly SoldCostLayer[]
  consumptionsByLayer?: ReadonlyMap<string, number>
  /**
   * Closed-won deal lines assigned to a cost layer. When any layer has a
   * fulfilment quantity, that assignment is the booked sold figure — FIFO
   * leftover only covers deals that were never pointed at a purchase.
   */
  fulfilmentSoldByLayer?: ReadonlyMap<string, number>
  totalPackageSold: number
}): Map<string, number> {
  const fulfilment = input.fulfilmentSoldByLayer
  const hasFulfilment = !!fulfilment && [...fulfilment.values()].some((n) => n > 0)
  const bookedSoldByLayer = new Map<string, number>()
  for (const layer of input.layers) {
    if (hasFulfilment) {
      const purchased = Math.max(0, Math.floor(Number(layer.quantity) || 0))
      const assigned = Math.max(0, Math.floor(fulfilment!.get(layer.id) ?? 0))
      bookedSoldByLayer.set(layer.id, Math.min(purchased, assigned))
      continue
    }
    bookedSoldByLayer.set(layer.id, layerBookedSold(layer, input.consumptionsByLayer ?? new Map()))
  }
  return allocateUnattributedSoldAcrossLayers({
    layers: input.layers,
    bookedSoldByLayer,
    totalPackageSold: input.totalPackageSold,
  })
}

export function recordFromSoldMap(map: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, qty] of map) {
    if (qty > 0) out[id] = qty
  }
  return out
}

export function soldMapFromRecord(record: Record<string, number> | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!record) return out
  for (const [id, qty] of Object.entries(record)) {
    const n = Math.max(0, Math.floor(Number(qty) || 0))
    if (n > 0) out.set(id, n)
  }
  return out
}
