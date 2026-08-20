import { dealSupplierKey } from "@/lib/crm/deal-supplier-options"
import {
  allocatePartyPreferSingleSupplier,
  type AllocatableSupplierLayer,
} from "@/lib/inventory/single-supplier-allocate"

export type OperationsStockLayer = {
  costLayerId: string
  packageId: string
  supplierId: string | null
  supplierName: string
  supplierKey: string
  remaining: number
  unitCost: number
  currency: string
  source: string | null
  purchaseOrderId: string | null
  fulfilmentBlockId: string | null
  receivedAt: string | null
}

export type OperationsStockAllocation = {
  orderId: string
  packageId: string
  costLayerId: string | null
  quantity: number
  supplierKey: string
  supplierName: string
  supplierId: string | null
}

export type OperationsSupplierOption = {
  key: string
  supplierName: string
  supplierId: string | null
  remaining: number
  available: number
  using: number
  canCover: boolean
}

export type SupplierStockDraft = {
  key: string
  supplierKey: string
  quantity: string
}

export type LayerTake = {
  costLayerId: string
  quantity: number
}

export function stockLayerKey(layer: {
  supplierId?: string | null
  source?: string | null
  costLayerId?: string | null
}): string {
  return dealSupplierKey({
    supplierId: layer.supplierId,
    source: layer.source,
    layerId: layer.costLayerId,
  })
}

function uniqueLayers(rows: readonly OperationsStockLayer[]): OperationsStockLayer[] {
  const seen = new Set<string>()
  const out: OperationsStockLayer[] = []
  for (const row of rows) {
    if (seen.has(row.costLayerId)) continue
    seen.add(row.costLayerId)
    out.push(row)
  }
  return out
}

function allocatedLayerIds(
  allocations: readonly OperationsStockAllocation[],
  packageId: string,
  orderId?: string,
): Set<string> {
  return new Set(
    allocations
      .filter(
        (row) =>
          row.packageId === packageId &&
          (!orderId || row.orderId === orderId) &&
          Boolean(row.costLayerId),
      )
      .map((row) => row.costLayerId as string),
  )
}

export function layersForLine(
  layers: readonly OperationsStockLayer[],
  packageId: string,
  ledgerPackageId: string,
  allocations: readonly OperationsStockAllocation[] = [],
  orderId?: string,
): OperationsStockLayer[] {
  const allocatedIds = allocatedLayerIds(allocations, packageId, orderId)
  return uniqueLayers([
    ...layers.filter((layer) => layer.packageId === packageId || layer.packageId === ledgerPackageId),
    ...layers.filter((layer) => allocatedIds.has(layer.costLayerId)),
  ])
}

export function availableOnLayer(
  layer: OperationsStockLayer,
  orderId: string,
  allocations: readonly OperationsStockAllocation[],
): number {
  const taken = allocations
    .filter((row) => row.orderId === orderId && row.costLayerId === layer.costLayerId)
    .reduce((sum, row) => sum + row.quantity, 0)
  return Math.max(0, layer.remaining) + taken
}

export type UnlinkedDealSale = {
  packageId: string
  costLayerId: string | null
  supplierKey: string | null
  quantity: number
}

function layerPoolForPackage(
  layers: readonly OperationsStockLayer[],
  packageId: string,
  ledgerPackageId: string,
): OperationsStockLayer[] {
  return [...layers]
    .filter((layer) => layer.packageId === packageId || layer.packageId === ledgerPackageId)
    .sort((a, b) => {
      const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0
      const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0
      if (aTime !== bTime) return aTime - bTime
      return a.costLayerId.localeCompare(b.costLayerId)
    })
}

function takeFromLayers(pool: readonly OperationsStockLayer[], quantity: number): number {
  let leftover = Math.max(0, Math.floor(quantity))
  for (const layer of pool) {
    if (leftover <= 0) break
    const take = Math.min(Math.max(0, layer.remaining), leftover)
    if (take <= 0) continue
    layer.remaining -= take
    leftover -= take
  }
  return leftover
}

/**
 * Confirmed deals without a native order do not write cost-layer consumptions,
 * so `quantity_remaining` still looks fully in stock. Reduce leftover by those
 * mapped (and unassigned) sales so Operations matches catalog sold/left.
 */
export function applyUnlinkedDealSalesToRemaining(
  layers: OperationsStockLayer[],
  sales: readonly UnlinkedDealSale[],
  ledgerByPackage: ReadonlyMap<string, string> = new Map(),
): void {
  const byId = new Map(layers.map((layer) => [layer.costLayerId, layer]))
  const overflow: UnlinkedDealSale[] = []

  for (const sale of sales) {
    const quantity = Math.max(0, Math.floor(sale.quantity))
    if (quantity <= 0) continue
    if (sale.costLayerId) {
      const layer = byId.get(sale.costLayerId)
      if (layer) {
        const take = Math.min(Math.max(0, layer.remaining), quantity)
        layer.remaining -= take
        if (quantity > take) {
          overflow.push({ ...sale, costLayerId: null, quantity: quantity - take })
        }
        continue
      }
    }
    overflow.push({ ...sale, costLayerId: null, quantity })
  }

  for (const sale of overflow) {
    const ledgerId = ledgerByPackage.get(sale.packageId) ?? sale.packageId
    const pool = layerPoolForPackage(layers, sale.packageId, ledgerId)
    const preferred = sale.supplierKey
      ? [
          ...pool.filter((layer) => layer.supplierKey === sale.supplierKey),
          ...pool.filter((layer) => layer.supplierKey !== sale.supplierKey),
        ]
      : pool
    takeFromLayers(preferred, sale.quantity)
  }
}

export function groupSupplierOptions(
  layers: readonly OperationsStockLayer[],
  allocations: readonly OperationsStockAllocation[],
  orderId: string,
  packageId: string,
  ledgerPackageId: string,
  lineQty: number,
): OperationsSupplierOption[] {
  const pool = layersForLine(layers, packageId, ledgerPackageId, allocations, orderId)
  const grouped = new Map<string, OperationsSupplierOption>()
  for (const layer of pool) {
    const available = availableOnLayer(layer, orderId, allocations)
    const remaining = Math.max(0, layer.remaining)
    const current = grouped.get(layer.supplierKey)
    if (current) {
      current.available += available
      current.remaining += remaining
      continue
    }
    grouped.set(layer.supplierKey, {
      key: layer.supplierKey,
      supplierName: layer.supplierName,
      supplierId: layer.supplierId,
      remaining,
      available,
      using: 0,
      canCover: false,
    })
  }

  for (const row of allocations) {
    if (row.orderId !== orderId || row.packageId !== packageId) continue
    const current = grouped.get(row.supplierKey)
    if (!current) {
      grouped.set(row.supplierKey, {
        key: row.supplierKey,
        supplierName: row.supplierName,
        supplierId: row.supplierId,
        remaining: 0,
        available: row.quantity,
        using: row.quantity,
        canCover: false,
      })
      continue
    }
    current.using += row.quantity
  }

  const needed = Math.max(0, Math.floor(lineQty))
  return [...grouped.values()]
    .map((option) => {
      const available = option.remaining + option.using
      return {
        ...option,
        available,
        canCover: needed <= 0 || available >= needed,
      }
    })
    .filter((option) => option.available > 0 || option.using > 0)
    .sort((a, b) => {
      if (a.canCover !== b.canCover) return a.canCover ? -1 : 1
      if (a.using !== b.using) return b.using - a.using
      return a.supplierName.localeCompare(b.supplierName)
    })
}

export function buildSupplierDrafts(
  options: readonly OperationsSupplierOption[],
  lineQty: number,
): SupplierStockDraft[] {
  const using = options.filter((option) => option.using > 0)
  if (using.length === 0) {
    const cover = options.find((option) => option.canCover)
    return [
      {
        key: "row-1",
        supplierKey: cover?.key ?? "",
        quantity: String(Math.max(1, Math.floor(lineQty) || 1)),
      },
    ]
  }
  return using.map((option, index) => ({
    key: `row-${index + 1}`,
    supplierKey: option.key,
    quantity: String(option.using),
  }))
}

function mergeTakes(takes: readonly LayerTake[]): LayerTake[] {
  const merged = new Map<string, number>()
  for (const take of takes) {
    if (!take.costLayerId || take.quantity <= 0) continue
    merged.set(take.costLayerId, (merged.get(take.costLayerId) ?? 0) + take.quantity)
  }
  return [...merged.entries()].map(([costLayerId, quantity]) => ({ costLayerId, quantity }))
}

function shrinkTakes(takes: readonly LayerTake[], quantity: number): LayerTake[] {
  let left = Math.max(0, Math.floor(quantity))
  const out: LayerTake[] = []
  for (const take of takes) {
    if (left <= 0) break
    const keep = Math.min(take.quantity, left)
    if (keep > 0) out.push({ costLayerId: take.costLayerId, quantity: keep })
    left -= keep
  }
  return out
}

function toAllocatableLayer(
  layer: OperationsStockLayer,
  available: number,
): AllocatableSupplierLayer {
  return {
    id: layer.costLayerId,
    available: Math.max(0, available),
    unit_cost: layer.unitCost,
    currency: layer.currency,
    source: layer.source,
    purchase_order_id: layer.purchaseOrderId,
    fulfilment_block_id: layer.fulfilmentBlockId,
    received_at: layer.receivedAt,
    supplier: layer.supplierName,
  }
}

export function layerTakesForSupplier(
  layers: readonly OperationsStockLayer[],
  allocations: readonly OperationsStockAllocation[],
  orderId: string,
  packageId: string,
  ledgerPackageId: string,
  supplierKey: string,
  quantity: number,
): LayerTake[] {
  const qty = Math.max(0, Math.floor(quantity))
  if (!supplierKey || qty <= 0) return []
  const pool = uniqueLayers([
    ...layersForLine(layers, packageId, ledgerPackageId, allocations, orderId),
    ...layers.filter((layer) =>
      allocations.some(
        (row) =>
          row.orderId === orderId &&
          row.packageId === packageId &&
          row.supplierKey === supplierKey &&
          row.costLayerId === layer.costLayerId,
      ),
    ),
  ]).filter((layer) => layer.supplierKey === supplierKey)

  const currentTakes = mergeTakes(
    allocations
      .filter(
        (row) =>
          row.orderId === orderId &&
          row.packageId === packageId &&
          row.supplierKey === supplierKey &&
          Boolean(row.costLayerId),
      )
      .map((row) => ({ costLayerId: row.costLayerId as string, quantity: row.quantity })),
  )
  const currentTotal = currentTakes.reduce((sum, take) => sum + take.quantity, 0)
  if (qty <= currentTotal) return shrinkTakes(currentTakes, qty)

  const extra = qty - currentTotal
  const leftover = pool
    .filter((layer) => layer.remaining > 0)
    .map((layer) => toAllocatableLayer(layer, layer.remaining))
  const extraTakes = allocatePartyPreferSingleSupplier(leftover, extra).map((take) => ({
    costLayerId: take.costLayerId,
    quantity: take.quantity,
  }))
  return mergeTakes([...currentTakes, ...extraTakes])
}

export function layerTakesForDrafts(
  drafts: readonly SupplierStockDraft[],
  layers: readonly OperationsStockLayer[],
  allocations: readonly OperationsStockAllocation[],
  orderId: string,
  packageId: string,
  ledgerPackageId: string,
): LayerTake[] {
  const merged = new Map<string, number>()
  for (const draft of drafts) {
    const quantity = Math.floor(Number(draft.quantity))
    if (!draft.supplierKey || !Number.isInteger(quantity) || quantity <= 0) continue
    for (const take of layerTakesForSupplier(
      layers,
      allocations,
      orderId,
      packageId,
      ledgerPackageId,
      draft.supplierKey,
      quantity,
    )) {
      merged.set(take.costLayerId, (merged.get(take.costLayerId) ?? 0) + take.quantity)
    }
  }
  return [...merged.entries()].map(([costLayerId, quantity]) => ({ costLayerId, quantity }))
}

export function validateSupplierDrafts(
  drafts: readonly SupplierStockDraft[],
  options: readonly OperationsSupplierOption[],
  lineQty: number,
): string | null {
  const needed = Math.max(0, Math.floor(lineQty))
  if (needed <= 0) return "This product has no quantity to assign."
  const seen = new Set<string>()
  let total = 0
  for (const draft of drafts) {
    const supplierKey = draft.supplierKey.trim()
    if (!supplierKey) return "Choose a supplier for every row."
    if (seen.has(supplierKey)) return "Each supplier can only appear once. Combine the quantities instead."
    seen.add(supplierKey)
    const quantity = Math.floor(Number(draft.quantity))
    if (!Number.isInteger(quantity) || quantity <= 0) return "Each row needs at least one place."
    const option = options.find((item) => item.key === supplierKey)
    if (!option) return "Choose a supplier that still has remaining stock."
    if (quantity > option.available) {
      return `${option.supplierName} only has ${option.available} place${option.available === 1 ? "" : "s"} available.`
    }
    total += quantity
  }
  if (total !== needed) {
    return `Assigned places must equal ${needed} (currently ${total}).`
  }
  return null
}

export function previewSupplierOptions(
  options: readonly OperationsSupplierOption[],
  drafts: readonly SupplierStockDraft[],
): OperationsSupplierOption[] {
  const usingByKey = new Map<string, number>()
  for (const draft of drafts) {
    const quantity = Math.floor(Number(draft.quantity))
    if (!draft.supplierKey || !Number.isInteger(quantity) || quantity < 0) continue
    usingByKey.set(draft.supplierKey, (usingByKey.get(draft.supplierKey) ?? 0) + quantity)
  }
  return options.map((option) => {
    const using = usingByKey.get(option.key) ?? 0
    return {
      ...option,
      using,
      remaining: option.remaining + option.using - using,
    }
  })
}

export function summarizeSupplierAssignment(
  allocations: readonly OperationsStockAllocation[],
  options: readonly OperationsSupplierOption[],
  orderId: string,
  packageId: string,
): string {
  const bySupplier = new Map<string, { name: string; quantity: number; remaining: number }>()
  for (const row of allocations) {
    if (row.orderId !== orderId || row.packageId !== packageId) continue
    const option = options.find((item) => item.key === row.supplierKey)
    const current = bySupplier.get(row.supplierKey)
    if (current) {
      current.quantity += row.quantity
      continue
    }
    bySupplier.set(row.supplierKey, {
      name: option?.supplierName || row.supplierName || "Unassigned",
      quantity: row.quantity,
      remaining: option?.remaining ?? 0,
    })
  }
  if (bySupplier.size === 0) return ""
  return [...bySupplier.values()]
    .map((row) => `${row.quantity}× ${row.name} · ${row.remaining} left`)
    .join(", ")
}

export type OrderStockSummaryLine = {
  packageId: string
  description: string
  assignment: string
}

export function orderStockSummaries(
  lines: readonly {
    orderId: string
    packageId: string
    description: string
    ledgerPackageId: string
    quantity: number
  }[],
  layers: readonly OperationsStockLayer[],
  allocations: readonly OperationsStockAllocation[],
  orderId: string,
): OrderStockSummaryLine[] {
  return groupOrderPackages(lines.filter((line) => line.orderId === orderId)).map((line) => {
    const options = groupSupplierOptions(
      layers,
      allocations,
      orderId,
      line.packageId,
      line.ledgerPackageId,
      line.quantity,
    )
    return {
      packageId: line.packageId,
      description: line.description,
      assignment: summarizeSupplierAssignment(allocations, options, orderId, line.packageId) || "Unassigned",
    }
  })
}

export function summarizeOrderStock(
  lines: readonly {
    orderId: string
    packageId: string
    description: string
    ledgerPackageId: string
    quantity: number
  }[],
  layers: readonly OperationsStockLayer[],
  allocations: readonly OperationsStockAllocation[],
  orderId: string,
): string {
  const rows = orderStockSummaries(lines, layers, allocations, orderId)
  if (rows.length === 0) return ""
  if (rows.length === 1) return rows[0]?.assignment === "Unassigned" ? "" : rows[0]?.assignment ?? ""
  return rows.map((row) => `${row.description}: ${row.assignment}`).join("; ")
}

export function summarizeMappedSuppliers(
  lines: readonly {
    quantity: number
    supplierName: string | null
    remaining?: number | null
  }[],
): string {
  const grouped = new Map<string, { quantity: number; remaining: number | null }>()
  for (const line of lines) {
    const name = line.supplierName?.trim()
    if (!name) continue
    const current = grouped.get(name)
    const remaining = line.remaining == null ? null : Math.max(0, Math.floor(Number(line.remaining) || 0))
    if (current) {
      current.quantity += Number(line.quantity) || 0
      if (current.remaining == null) current.remaining = remaining
      else if (remaining != null) current.remaining = Math.min(current.remaining, remaining)
      continue
    }
    grouped.set(name, { quantity: Number(line.quantity) || 0, remaining })
  }
  if (grouped.size === 0) return ""
  return [...grouped.entries()]
    .map(([name, row]) =>
      row.remaining == null ? `${row.quantity}× ${name}` : `${row.quantity}× ${name} · ${row.remaining} left`,
    )
    .join(", ")
}

export function groupOrderPackages<T extends { packageId: string; description: string; quantity: number }>(
  lines: readonly T[],
): Array<T & { quantity: number }> {
  const grouped = new Map<string, T & { quantity: number }>()
  for (const line of lines) {
    const current = grouped.get(line.packageId)
    if (current) {
      current.quantity += Number(line.quantity) || 0
      continue
    }
    grouped.set(line.packageId, { ...line, quantity: Number(line.quantity) || 0 })
  }
  return [...grouped.values()]
}

export function collapseTakesBySupplier(
  takes: readonly LayerTake[],
  layers: readonly { id: string; supplierId: string | null }[],
): LayerTake[] {
  const supplierOf = new Map(layers.map((layer) => [layer.id, layer.supplierId || layer.id]))
  const grouped = new Map<string, LayerTake>()
  for (const take of takes) {
    const quantity = Math.max(0, Math.floor(take.quantity))
    if (!take.costLayerId || quantity <= 0) continue
    const key = supplierOf.get(take.costLayerId) || take.costLayerId
    const current = grouped.get(key)
    if (!current) {
      grouped.set(key, { costLayerId: take.costLayerId, quantity })
      continue
    }
    if (quantity > current.quantity) current.costLayerId = take.costLayerId
    current.quantity += quantity
  }
  return [...grouped.values()]
}

export function assignTakesToDealLines(
  lines: readonly { id: string; quantity: number }[],
  takes: readonly LayerTake[],
): { ok: true; assignments: Array<{ lineId: string; costLayerId: string }> } | { ok: false; message: string } {
  const needed = lines.reduce((sum, line) => sum + Math.max(0, Math.floor(line.quantity)), 0)
  const assigned = takes.reduce((sum, take) => sum + Math.max(0, Math.floor(take.quantity)), 0)
  if (lines.length === 0) return { ok: false, message: "This deal has no products to allocate." }
  if (needed !== assigned) {
    return { ok: false, message: `Assigned places must equal ${needed} (currently ${assigned}).` }
  }
  const remainingTakes = takes
    .map((take) => ({ costLayerId: take.costLayerId, quantity: Math.max(0, Math.floor(take.quantity)) }))
    .filter((take) => take.costLayerId && take.quantity > 0)
  const assignments: Array<{ lineId: string; costLayerId: string }> = []
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(line.quantity))
    if (qty <= 0) continue
    const exact = remainingTakes.findIndex((take) => take.quantity === qty)
    const index = exact >= 0 ? exact : remainingTakes.findIndex((take) => take.quantity >= qty)
    const take = index >= 0 ? remainingTakes[index] : null
    if (!take) {
      return {
        ok: false,
        message:
          "Each product line must stay on one supplier. Assign the full line quantity to one supplier, or split the product on the deal first.",
      }
    }
    assignments.push({ lineId: line.id, costLayerId: take.costLayerId })
    take.quantity -= qty
    if (take.quantity <= 0) remainingTakes.splice(index, 1)
  }
  if (remainingTakes.some((take) => take.quantity > 0)) {
    return {
      ok: false,
      message:
        "Each product line must stay on one supplier. Assign the full line quantity to one supplier, or split the product on the deal first.",
    }
  }
  return { ok: true, assignments }
}
