import { compareOldestSaleFirst } from "@/lib/inventory/sale-fill-order"
import { type SupplierAssignmentPlan } from "@/lib/inventory/supplier-assignment-plan"
import { costLayerSupplierPoolKey } from "@/lib/inventory/supplier-pool"

export type SupplierCogsLayer = {
  id: string
  quantity: number
  unit_cost: number
  received_at: string
  supplier_id?: string | null
  purchase_order_id?: string | null
  source?: string | null
  day_components?: Array<{
    day_slot: string
    quantity_total: number
    unit_cost_component?: number | null
    cost_weight?: number | null
  }>
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

type SlotStock = {
  left: number
  unit_cost: number
}

type LayerStock = {
  id: string
  whole: SlotStock
  components: Map<string, SlotStock>
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function money(value: number | null | undefined): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : Number.NaN
}

function componentUnitCost(
  layer: SupplierCogsLayer,
  component: NonNullable<SupplierCogsLayer["day_components"]>[number],
): number {
  if (component.unit_cost_component != null) {
    const explicit = money(component.unit_cost_component)
    if (Number.isFinite(explicit)) return explicit
  }
  const weight = money(component.cost_weight)
  if (Number.isFinite(weight)) return weight * money(layer.unit_cost)
  return Number.NaN
}

function saleSlots(slots: readonly string[] | undefined): readonly string[] {
  const cleaned = [...new Set((slots ?? []).map((slot) => slot.trim()).filter(Boolean))]
  if (cleaned.length === 0 || (cleaned.length === 1 && cleaned[0] === "unit")) {
    return ["unit"]
  }
  return cleaned.filter((slot) => slot !== "unit")
}

function takeFifo(
  layers: LayerStock[],
  quantity: number,
  pick: (layer: LayerStock) => SlotStock | null,
): number | null {
  let left = whole(quantity)
  if (left <= 0) return 0
  let cost = 0
  for (const layer of layers) {
    if (left <= 0) break
    const stock = pick(layer)
    if (!stock) continue
    const take = Math.min(left, stock.left)
    if (take <= 0) continue
    if (!Number.isFinite(stock.unit_cost)) return null
    cost += take * stock.unit_cost
    stock.left -= take
    left -= take
  }
  return left > 0 ? null : cost
}

function slotStock(layer: LayerStock, slot: string): SlotStock | null {
  if (slot === "unit") return layer.whole
  const component = layer.components.get(slot)
  if (component) return component
  return layer.components.size === 0 ? layer.whole : null
}

function consumeAssignment(
  layers: LayerStock[],
  slots: readonly string[],
  quantity: number,
): number | null {
  const qty = whole(quantity)
  if (qty <= 0) return 0
  if (slots.length === 1 && slots[0] === "unit") {
    return takeFifo(layers, qty, (layer) => slotStock(layer, "unit"))
  }
  let cost = 0
  for (const slot of slots) {
    const part = takeFifo(layers, qty, (layer) => slotStock(layer, slot))
    if (part == null) return null
    cost += part
  }
  return cost
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
        .map((layer) => {
          const components = new Map<string, SlotStock>()
          for (const component of layer.day_components ?? []) {
            const slot = component.day_slot.trim()
            if (!slot) continue
            const left = whole(component.quantity_total)
            const unitCost = componentUnitCost(layer, component)
            if (left <= 0 || !Number.isFinite(unitCost)) continue
            components.set(slot, { left, unit_cost: unitCost })
          }
          return {
            id: layer.id,
            whole: { left: whole(layer.quantity), unit_cost: money(layer.unit_cost) },
            components,
          }
        })
        .filter((layer) => layer.whole.left > 0 && Number.isFinite(layer.whole.unit_cost)),
    )
  }
  return remaining
}

/**
 * Buy-price COGS for each signed sale from the live supplier plan.
 * Oldest sales take FIFO layers first. A sale with any unassigned place has
 * no complete cost, so it stays blank until it is fully supplied.
 *
 * Linked-day buys charge each sale the matching day split (Saturday only
 * takes the Saturday component). Whole-unit layers keep the previous FIFO.
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
    if (sale.lineIds.length === 0) {
      bySale.set(sale.id, null)
      continue
    }
    let cogs = 0
    let known = true
    for (const lineId of sale.lineIds) {
      const assignment = input.plan.byLine.get(lineId)
      if (!assignment || assignment.needStock || assignment.unassigned > 0 || assignment.assigned <= 0) {
        known = false
        break
      }
      const slots = saleSlots(assignment.slots)
      for (const slice of assignment.slices) {
        const layers = remaining.get(slice.key)
        if (!layers) {
          known = false
          break
        }
        const sliceCost = consumeAssignment(layers, slots, slice.quantity)
        if (sliceCost == null) {
          known = false
          break
        }
        cogs += sliceCost
      }
      if (!known) break
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
