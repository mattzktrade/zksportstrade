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
  totalPackageSold: number
}): Map<string, number> {
  const bookedSoldByLayer = new Map<string, number>()
  for (const layer of input.layers) {
    bookedSoldByLayer.set(layer.id, layerBookedSold(layer, input.consumptionsByLayer ?? new Map()))
  }
  return allocateUnattributedSoldAcrossLayers({
    layers: input.layers,
    bookedSoldByLayer,
    totalPackageSold: input.totalPackageSold,
  })
}
