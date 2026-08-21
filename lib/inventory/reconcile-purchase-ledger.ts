import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveSoldByCostLayer } from "@/lib/inventory/sold-by-cost-layer"
import { packageIdsOnSharedThreeDayLedger } from "@/lib/inventory/linked-stock-ledger"
import { loadFulfilmentSoldByCostLayer, SOLD_DEAL_STAGES } from "@/lib/inventory/fulfilment-layer-sold"

type LayerRow = {
  id: string
  package_id: string
  quantity: number
  quantity_remaining: number
  unit_cost: number
  purchase_order_id: string | null
  received_at: string | null
}

export type PurchaseLedgerReconcileResult = {
  duplicateLayersRemoved: number
  emptyPurchaseOrdersRemoved: number
  layersRemainingUpdated: number
  inventoryAligned: number
  orphanInventoryCleared: number
  orderConsumptionsBackfilled: number
}

function asInt(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

async function backfillPortalOrderConsumptions(
  admin: SupabaseClient,
  packageId: string,
  layers: readonly LayerRow[],
): Promise<number> {
  if (layers.length === 0) return 0

  const { data: existing } = await admin
    .from("order_cost_consumptions")
    .select("order_id")
    .eq("package_id", packageId)
  const already = new Set((existing ?? []).map((row) => String(row.order_id)))

  const { data: orders } = await admin
    .from("orders")
    .select("id, guests, currency, created_at")
    .eq("package_id", packageId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })

  const missing = (orders ?? []).filter((order) => !already.has(String(order.id)))
  if (missing.length === 0) return 0

  const pool = [...layers]
    .sort((a, b) => {
      const aTime = a.received_at ? new Date(a.received_at).getTime() : 0
      const bTime = b.received_at ? new Date(b.received_at).getTime() : 0
      if (aTime !== bTime) return aTime - bTime
      return a.id.localeCompare(b.id)
    })
    .map((layer) => ({ id: layer.id, left: asInt(layer.quantity), unitCost: layer.unit_cost }))

  const rows: Array<{
    order_id: string
    cost_layer_id: string | null
    package_id: string
    quantity: number
    unit_cost: number | null
    currency: string
  }> = []

  for (const order of missing) {
    let remaining = asInt(order.guests)
    const currency = typeof order.currency === "string" && order.currency.trim() ? order.currency.trim() : "USD"
    for (const layer of pool) {
      if (remaining <= 0) break
      const take = Math.min(layer.left, remaining)
      if (take <= 0) continue
      rows.push({
        order_id: String(order.id),
        cost_layer_id: layer.id,
        package_id: packageId,
        quantity: take,
        unit_cost: layer.unitCost,
        currency,
      })
      layer.left -= take
      remaining -= take
    }
    if (remaining > 0) {
      rows.push({
        order_id: String(order.id),
        cost_layer_id: null,
        package_id: packageId,
        quantity: remaining,
        unit_cost: null,
        currency,
      })
    }
  }

  if (rows.length === 0) return 0
  const { error } = await admin.from("order_cost_consumptions").insert(rows)
  if (error) throw new Error(error.message)
  return missing.length
}

/**
 * Make purchase-order remaining and package inventory match the same ledger:
 * purchased from cost layers, remaining = purchased − actual sales (inferred from
 * current sellable when Salesforce/offline sales never wrote FIFO consumptions).
 */
export async function reconcilePurchaseLedgers(admin: SupabaseClient): Promise<PurchaseLedgerReconcileResult> {
  const result: PurchaseLedgerReconcileResult = {
    duplicateLayersRemoved: 0,
    emptyPurchaseOrdersRemoved: 0,
    layersRemainingUpdated: 0,
    inventoryAligned: 0,
    orphanInventoryCleared: 0,
    orderConsumptionsBackfilled: 0,
  }

  const { data: layers, error: layerErr } = await admin
    .from("package_cost_layers")
    .select("id, package_id, quantity, quantity_remaining, purchase_order_id, received_at, unit_cost")
  if (layerErr) throw new Error(layerErr.message)

  const { data: consumed } = await admin.from("order_cost_consumptions").select("cost_layer_id, package_id, quantity")
  const consumedLayerIds = new Set(
    (consumed ?? [])
      .map((row) => String(row.cost_layer_id ?? ""))
      .filter(Boolean),
  )

  const splitIds = await packageIdsOnSharedThreeDayLedger(
    admin,
    (layers ?? []).map((layer) => String(layer.package_id)),
  )
  const duplicateLayers = (layers ?? []).filter(
    (layer) => splitIds.has(String(layer.package_id)) && !consumedLayerIds.has(String(layer.id)),
  )
  if (duplicateLayers.length > 0) {
    const { error } = await admin
      .from("package_cost_layers")
      .delete()
      .in(
        "id",
        duplicateLayers.map((layer) => layer.id),
      )
    if (error) throw new Error(error.message)
    result.duplicateLayersRemoved = duplicateLayers.length

    const poIds = [
      ...new Set(duplicateLayers.map((layer) => layer.purchase_order_id).filter((id): id is string => Boolean(id))),
    ]
    if (poIds.length > 0) {
      const { data: remaining } = await admin
        .from("package_cost_layers")
        .select("purchase_order_id")
        .in("purchase_order_id", poIds)
      const stillUsed = new Set((remaining ?? []).map((row) => String(row.purchase_order_id)))
      const emptyPoIds = poIds.filter((id) => !stillUsed.has(id))
      if (emptyPoIds.length > 0) {
        await admin.from("purchase_order_documents").delete().in("purchase_order_id", emptyPoIds)
        const { error: poErr } = await admin.from("purchase_orders").delete().in("id", emptyPoIds)
        if (poErr) throw new Error(poErr.message)
        result.emptyPurchaseOrdersRemoved = emptyPoIds.length
      }
    }
  }

  const { data: liveLayers, error: liveErr } = await admin
    .from("package_cost_layers")
    .select("id, package_id, quantity, quantity_remaining, purchase_order_id, received_at, unit_cost")
  if (liveErr) throw new Error(liveErr.message)

  const { data: packages, error: pkgErr } = await admin
    .from("packages")
    .select("id, duration, inventory_group_id, shell_parent_package_id")
  if (pkgErr) throw new Error(pkgErr.message)
  const pkgById = new Map((packages ?? []).map((pkg) => [String(pkg.id), pkg]))

  const { data: inventory, error: invErr } = await admin
    .from("package_inventory")
    .select("package_id, qty_available, qty_held")
  if (invErr) throw new Error(invErr.message)
  const invById = new Map(
    (inventory ?? []).map((row) => [
      String(row.package_id),
      { available: asInt(row.qty_available), held: asInt(row.qty_held) },
    ]),
  )

  const { data: orders } = await admin.from("orders").select("package_id, guests").neq("status", "cancelled")
  const portalSoldByPkg = new Map<string, number>()
  for (const row of orders ?? []) {
    const id = String(row.package_id ?? "")
    portalSoldByPkg.set(id, (portalSoldByPkg.get(id) ?? 0) + asInt(row.guests))
  }
  const { data: dealLines } = await admin
    .from("deal_line_items")
    .select("package_id, quantity, deals!inner(order_id, stage)")
  for (const row of dealLines ?? []) {
    const deal = Array.isArray((row as { deals?: unknown }).deals)
      ? (row as { deals: Array<{ order_id?: string | null; stage?: string }> }).deals[0]
      : (row as { deals?: { order_id?: string | null; stage?: string } }).deals
    if (!deal || deal.order_id) continue
    if (!SOLD_DEAL_STAGES.has(String(deal.stage ?? ""))) continue
    const id = String(row.package_id ?? "")
    portalSoldByPkg.set(id, (portalSoldByPkg.get(id) ?? 0) + asInt(row.quantity))
  }

  const { data: liveConsumed } = await admin
    .from("order_cost_consumptions")
    .select("cost_layer_id, package_id, quantity")
  const consumedByLayer = new Map<string, number>()
  for (const row of liveConsumed ?? []) {
    const layerId = String(row.cost_layer_id ?? "")
    if (!layerId) continue
    consumedByLayer.set(layerId, (consumedByLayer.get(layerId) ?? 0) + asInt(row.quantity))
  }

  const layersByPkg = new Map<string, LayerRow[]>()
  for (const raw of liveLayers ?? []) {
    const row: LayerRow = {
      id: String(raw.id),
      package_id: String(raw.package_id),
      quantity: asInt(raw.quantity),
      quantity_remaining: asInt(raw.quantity_remaining),
      unit_cost: Number(raw.unit_cost) || 0,
      purchase_order_id: raw.purchase_order_id ? String(raw.purchase_order_id) : null,
      received_at: raw.received_at ? String(raw.received_at) : null,
    }
    const list = layersByPkg.get(row.package_id) ?? []
    list.push(row)
    layersByPkg.set(row.package_id, list)
  }

  for (const [packageId, pkgLayers] of layersByPkg) {
    result.orderConsumptionsBackfilled += await backfillPortalOrderConsumptions(admin, packageId, pkgLayers)
  }

  const { data: refreshedConsumed } = await admin
    .from("order_cost_consumptions")
    .select("cost_layer_id, quantity")
  consumedByLayer.clear()
  for (const row of refreshedConsumed ?? []) {
    const layerId = String(row.cost_layer_id ?? "")
    if (!layerId) continue
    consumedByLayer.set(layerId, (consumedByLayer.get(layerId) ?? 0) + asInt(row.quantity))
  }

  const splitLedgerIds = await packageIdsOnSharedThreeDayLedger(admin, [...layersByPkg.keys()])
  const fulfilmentSoldByLayer = await loadFulfilmentSoldByCostLayer(admin, [...layersByPkg.keys()])

  for (const [packageId, pkgLayers] of layersByPkg) {
    const purchased = pkgLayers.reduce((sum, layer) => sum + layer.quantity, 0)
    const inv = invById.get(packageId) ?? { available: 0, held: 0 }
    const portalSold = portalSoldByPkg.get(packageId) ?? 0
    const impliedSold = Math.max(0, purchased - inv.available)
    const sold = Math.min(purchased, Math.max(portalSold, impliedSold))
    const soldByLayer = resolveSoldByCostLayer({
      layers: pkgLayers,
      consumptionsByLayer: consumedByLayer,
      fulfilmentSoldByLayer,
      totalPackageSold: sold,
    })

    for (const layer of pkgLayers) {
      const nextRemaining = Math.max(0, layer.quantity - (soldByLayer.get(layer.id) ?? 0))
      if (nextRemaining === layer.quantity_remaining) continue
      const { error } = await admin
        .from("package_cost_layers")
        .update({ quantity_remaining: nextRemaining })
        .eq("id", layer.id)
      if (error) throw new Error(error.message)
      layer.quantity_remaining = nextRemaining
      result.layersRemainingUpdated += 1
    }

    const remaining = pkgLayers.reduce((sum, layer) => sum + layer.quantity_remaining, 0)
    const nextAvailable = Math.max(inv.held, remaining)
    if (splitLedgerIds.has(packageId)) continue
    if (nextAvailable !== inv.available) {
      const { error } = await admin
        .from("package_inventory")
        .update({ qty_available: nextAvailable })
        .eq("package_id", packageId)
      if (error) throw new Error(error.message)
      inv.available = nextAvailable
      result.inventoryAligned += 1
    }
  }

  const ledgerPackageIds = new Set(layersByPkg.keys())
  for (const [packageId, inv] of invById) {
    if (inv.available <= 0) continue
    const pkg = pkgById.get(packageId)
    if (!pkg || pkg.shell_parent_package_id) continue
    if (ledgerPackageIds.has(packageId)) continue
    const groupId = typeof pkg.inventory_group_id === "string" ? pkg.inventory_group_id.trim() : ""
    const sharesLedger =
      groupId &&
      [...ledgerPackageIds].some((id) => {
        const sibling = pkgById.get(id)
        return (
          sibling?.inventory_group_id === groupId &&
          (sibling.duration === "3_day" || sibling.duration === "2_day")
        )
      })
    if (sharesLedger) continue
    const nextAvailable = inv.held
    if (nextAvailable === inv.available) continue
    const { error } = await admin
      .from("package_inventory")
      .update({ qty_available: nextAvailable })
      .eq("package_id", packageId)
    if (error) throw new Error(error.message)
    result.orphanInventoryCleared += 1
  }

  return result
}
