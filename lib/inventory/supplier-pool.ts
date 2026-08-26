import { targetDaySlotCapacity } from "@/lib/inventory/day-cost-allocation"

export type SupplierPoolLayer = {
  id: string
  quantity: number
  quantity_remaining: number
  supplier_id: string | null
  purchase_order_id: string | null
  source: string | null
  day_components?: Array<{
    day_slot: string
    quantity_total: number
  }>
}

export type SupplierPoolPurchase = {
  id: string
  supplier: string
  supplier_id: string | null
}

export type SupplierPoolOption = {
  key: string
  name: string
  purchased: number
  targetCapacity: number
  remaining: number
  purchaseCount: number
  capacityBySlot: Record<string, number>
}

/** Purchase-order supplier wins so renaming a PO actually moves it to a new pool. */
export function effectiveCostLayerSupplierId(input: {
  layerSupplierId?: string | null
  purchaseSupplierId?: string | null
}): string | null {
  const purchaseId = input.purchaseSupplierId?.trim() || null
  const layerId = input.layerSupplierId?.trim() || null
  return purchaseId || layerId
}

export function costLayerSupplierPoolName(input: {
  purchaseSupplier?: string | null
  layerSource?: string | null
}): string {
  return (input.purchaseSupplier || input.layerSource || "").trim()
}

export function costLayerSupplierPoolKey(input: {
  layerSupplierId?: string | null
  purchaseSupplierId?: string | null
  purchaseSupplier?: string | null
  layerSource?: string | null
}): string {
  const name = costLayerSupplierPoolName(input)
  const supplierId = effectiveCostLayerSupplierId(input)
  if (supplierId) return `id:${supplierId}`
  if (name) return `name:${name.toLowerCase()}`
  return ""
}

export function groupSupplierPoolOptions(
  costLayers: readonly SupplierPoolLayer[],
  purchaseOrders: readonly SupplierPoolPurchase[],
  targetSlots: readonly string[],
): SupplierPoolOption[] {
  const grouped = new Map<string, SupplierPoolOption>()
  const purchaseOrderById = new Map(purchaseOrders.map((order) => [order.id, order]))
  const supplierIdByName = new Map<string, string>()
  for (const layer of costLayers) {
    const purchase = layer.purchase_order_id
      ? purchaseOrderById.get(layer.purchase_order_id)
      : null
    const name = costLayerSupplierPoolName({
      purchaseSupplier: purchase?.supplier,
      layerSource: layer.source,
    }).toLowerCase()
    const supplierId = effectiveCostLayerSupplierId({
      layerSupplierId: layer.supplier_id,
      purchaseSupplierId: purchase?.supplier_id,
    })
    if (name && supplierId) supplierIdByName.set(name, supplierId)
  }
  for (const layer of costLayers) {
    const purchase = layer.purchase_order_id
      ? purchaseOrderById.get(layer.purchase_order_id)
      : null
    const name = costLayerSupplierPoolName({
      purchaseSupplier: purchase?.supplier,
      layerSource: layer.source,
    })
    if (!name) continue
    const supplierId =
      effectiveCostLayerSupplierId({
        layerSupplierId: layer.supplier_id,
        purchaseSupplierId: purchase?.supplier_id,
      }) ?? supplierIdByName.get(name.toLowerCase())
    const key = supplierId ? `id:${supplierId}` : `name:${name.toLowerCase()}`
    const current = grouped.get(key)
    if (current) {
      current.purchased += Math.max(0, Math.floor(Number(layer.quantity)))
      current.remaining += Math.max(0, Math.floor(Number(layer.quantity_remaining)))
      current.purchaseCount += 1
      for (const component of layer.day_components ?? []) {
        current.capacityBySlot[component.day_slot] =
          (current.capacityBySlot[component.day_slot] ?? 0) +
          Math.max(0, Math.floor(Number(component.quantity_total)))
      }
    } else {
      grouped.set(key, {
        key,
        name,
        purchased: Math.max(0, Math.floor(Number(layer.quantity))),
        targetCapacity: 0,
        remaining: Math.max(0, Math.floor(Number(layer.quantity_remaining))),
        purchaseCount: 1,
        capacityBySlot: Object.fromEntries(
          (layer.day_components ?? []).map((component) => [
            component.day_slot,
            Math.max(0, Math.floor(Number(component.quantity_total))),
          ]),
        ),
      })
    }
  }
  return [...grouped.values()]
    .map((supplier) => {
      supplier.targetCapacity = targetDaySlotCapacity(
        supplier.purchased,
        supplier.capacityBySlot,
        targetSlots,
      )
      return supplier
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
