import { compareOldestSaleFirst } from "@/lib/inventory/sale-fill-order"
import {
  assignmentForLines,
  type SupplierAssignmentPlan,
} from "@/lib/inventory/supplier-assignment-plan"
import { costLayerSupplierPoolKey } from "@/lib/inventory/supplier-pool"

export type SupplierCogsLayer = {
  id: string
  quantity: number
  unit_cost: number
  received_at: string
  supplier_id?: string | null
  purchase_order_id?: string | null
  source?: string | null
}

export type SupplierCogsPurchase = {
  id: string
  supplier: string
  supplier_id: string | null
}

export type SupplierCogsSale = {
  id: string
  lineIds: readonly string[]
  createdAt: string
  reference?: string | null
  dealReference?: string | null
}

type LayerStock = {
  id: string
  left: number
  unit_cost: number
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function consumeFifo(layers: LayerStock[], quantity: number): number | null {
  let left = whole(quantity)
  if (left <= 0) return 0
  let cost = 0
  for (const layer of layers) {
    if (left <= 0) break
    const take = Math.min(left, layer.left)
    if (take <= 0) continue
    if (!Number.isFinite(layer.unit_cost)) return null
    cost += take * layer.unit_cost
    layer.left -= take
    left -= take
  }
  return left > 0 ? null : cost
}

function layersByPool(
  layers: readonly SupplierCogsLayer[],
  purchases: readonly SupplierCogsPurchase[],
): Map<string, LayerStock[]> {
  const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]))
  const grouped = new Map<string, SupplierCogsLayer[]>()
  for (const layer of layers) {
    const purchase = layer.purchase_order_id
      ? purchaseById.get(layer.purchase_order_id)
      : null
    const key = costLayerSupplierPoolKey({
      layerSupplierId: layer.supplier_id,
      purchaseSupplierId: purchase?.supplier_id,
      purchaseSupplier: purchase?.supplier,
      layerSource: layer.source,
    })
    if (!key) continue
    const list = grouped.get(key) ?? []
    list.push(layer)
    grouped.set(key, list)
  }
  const remaining = new Map<string, LayerStock[]>()
  for (const [key, list] of grouped) {
    remaining.set(
      key,
      [...list]
        .sort(
          (left, right) =>
            left.received_at.localeCompare(right.received_at) || left.id.localeCompare(right.id),
        )
        .map((layer) => ({
          id: layer.id,
          left: whole(layer.quantity),
          unit_cost: Number(layer.unit_cost),
        }))
        .filter((layer) => layer.left > 0 && Number.isFinite(layer.unit_cost)),
    )
  }
  return remaining
}

/**
 * Buy-price COGS for each signed sale from the live supplier plan.
 * Oldest sales take FIFO layers first. A sale with any unassigned place has
 * no complete cost, so it stays blank until it is fully supplied.
 */
export function planSupplierAssignmentCogs(input: {
  plan: SupplierAssignmentPlan
  sales: readonly SupplierCogsSale[]
  layers: readonly SupplierCogsLayer[]
  purchases?: readonly SupplierCogsPurchase[]
}): Map<string, number | null> {
  const remaining = layersByPool(input.layers, input.purchases ?? [])
  const ordered = [...input.sales].sort(compareOldestSaleFirst)
  const bySale = new Map<string, number | null>()

  for (const sale of ordered) {
    const assignment = assignmentForLines(input.plan, sale.lineIds)
    if (assignment.needStock || assignment.unassigned > 0 || assignment.assigned <= 0) {
      bySale.set(sale.id, null)
      continue
    }
    let cogs = 0
    let known = true
    for (const slice of assignment.slices) {
      const layers = remaining.get(slice.key)
      if (!layers) {
        known = false
        break
      }
      const sliceCost = consumeFifo(layers, slice.quantity)
      if (sliceCost == null) {
        known = false
        break
      }
      cogs += sliceCost
    }
    bySale.set(sale.id, known ? cogs : null)
  }

  return bySale
}

export function saleProfitFromCogs(
  revenue: number,
  cogs: number | null,
): { cogs: number | null; profit: number | null; margin: number | null } {
  if (cogs == null || !Number.isFinite(cogs)) {
    return { cogs: null, profit: null, margin: null }
  }
  const total = Number(revenue)
  const profit = Number.isFinite(total) ? total - cogs : null
  return {
    cogs,
    profit,
    margin: profit == null || !Number.isFinite(total) || total <= 0 ? null : profit / total,
  }
}
