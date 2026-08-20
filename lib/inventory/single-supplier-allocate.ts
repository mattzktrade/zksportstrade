/**
 * Prefer keeping a party on one fulfilment block / purchase order / supplier,
 * matching allocate_order_cost_layers and Salesforce Stock Sources.
 */

export type AllocatableSupplierLayer = {
  id: string
  available: number
  unit_cost: number
  currency: string
  source: string | null
  purchase_order_id: string | null
  fulfilment_block_id: string | null
  received_at: string | null
  supplier: string
}

export type SupplierAllocationTake = {
  costLayerId: string
  supplier: string
  quantity: number
  unitCost: number
  currency: string
}

function receivedTime(iso: string | null): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

function sortFifo<T extends { id: string; received_at: string | null }>(layers: T[]): T[] {
  return [...layers].sort((a, b) => {
    const byDate = receivedTime(a.received_at) - receivedTime(b.received_at)
    if (byDate !== 0) return byDate
    return a.id.localeCompare(b.id)
  })
}

function takeFromLayers(
  layers: AllocatableSupplierLayer[],
  guests: number,
): SupplierAllocationTake[] {
  const takes: SupplierAllocationTake[] = []
  let left = guests
  for (const layer of layers) {
    if (left <= 0) break
    const take = Math.min(layer.available, left)
    if (take <= 0) continue
    takes.push({
      costLayerId: layer.id,
      supplier: layer.supplier.trim() || "Unassigned",
      quantity: take,
      unitCost: layer.unit_cost,
      currency: layer.currency,
    })
    layer.available -= take
    left -= take
  }
  return takes
}

function firstGroupCovering(
  layers: AllocatableSupplierLayer[],
  guests: number,
  keyOf: (layer: AllocatableSupplierLayer) => string | null,
): string | null {
  const totals = new Map<string, { remaining: number; firstAt: number }>()
  for (const layer of layers) {
    const key = keyOf(layer)
    if (!key || layer.available <= 0) continue
    const prev = totals.get(key)
    const firstAt = receivedTime(layer.received_at)
    if (!prev) {
      totals.set(key, { remaining: layer.available, firstAt })
    } else {
      prev.remaining += layer.available
      if (firstAt < prev.firstAt) prev.firstAt = firstAt
    }
  }
  const covering = [...totals.entries()]
    .filter(([, v]) => v.remaining >= guests)
    .sort((a, b) => a[1].firstAt - b[1].firstAt || a[0].localeCompare(b[0]))
  return covering[0]?.[0] ?? null
}

/** Allocate one party, preferring a single block / PO / supplier, then FIFO. */
export function allocatePartyPreferSingleSupplier(
  layers: AllocatableSupplierLayer[],
  guests: number,
): SupplierAllocationTake[] {
  const qty = Math.max(0, Math.floor(guests))
  if (qty <= 0) return []
  const ordered = sortFifo(layers.filter((layer) => layer.available > 0))
  if (ordered.length === 0) return []

  const blockKey = firstGroupCovering(
    ordered,
    qty,
    (layer) => (layer.fulfilment_block_id?.trim() ? `block:${layer.fulfilment_block_id}` : null),
  )
  if (blockKey) {
    return takeFromLayers(
      ordered.filter((layer) => `block:${layer.fulfilment_block_id ?? ""}` === blockKey),
      qty,
    )
  }

  const poKey = firstGroupCovering(
    ordered,
    qty,
    (layer) => (layer.purchase_order_id?.trim() ? `po:${layer.purchase_order_id}` : null),
  )
  if (poKey) {
    return takeFromLayers(
      ordered.filter((layer) => `po:${layer.purchase_order_id ?? ""}` === poKey),
      qty,
    )
  }

  const sourceKey = firstGroupCovering(ordered, qty, (layer) => {
    const source = layer.source?.trim()
    if (!source || layer.purchase_order_id || layer.fulfilment_block_id) return null
    return `src:${source.toLowerCase()}`
  })
  if (sourceKey) {
    return takeFromLayers(
      ordered.filter((layer) => {
        const source = layer.source?.trim()
        if (!source || layer.purchase_order_id || layer.fulfilment_block_id) return false
        return `src:${source.toLowerCase()}` === sourceKey
      }),
      qty,
    )
  }

  const single = ordered.find((layer) => layer.available >= qty)
  if (single) return takeFromLayers([single], qty)

  return takeFromLayers(ordered, qty)
}

export function summarizeSupplierTakes(takes: readonly SupplierAllocationTake[]): string {
  if (takes.length === 0) return ""
  const bySupplier = new Map<string, number>()
  for (const take of takes) {
    bySupplier.set(take.supplier, (bySupplier.get(take.supplier) ?? 0) + take.quantity)
  }
  return [...bySupplier.entries()]
    .map(([supplier, quantity]) => (bySupplier.size === 1 ? supplier : `${quantity}× ${supplier}`))
    .join(" · ")
}

export function cogsFromTakes(takes: readonly SupplierAllocationTake[]): number | null {
  if (takes.length === 0) return null
  let total = 0
  for (const take of takes) {
    if (!Number.isFinite(take.unitCost)) return null
    total += take.unitCost * take.quantity
  }
  return total
}
