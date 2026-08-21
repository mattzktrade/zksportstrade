import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveSoldByCostLayer } from "@/lib/inventory/sold-by-cost-layer"
import {
  packageIdsOnSharedThreeDayLedger,
  resolveLinkedStockLedger,
  isLinkedSplitDuration,
} from "@/lib/inventory/linked-stock-ledger"

export const SOLD_DEAL_STAGES = new Set([
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
])

function asInt(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0))
}

export async function loadFulfilmentSoldByCostLayer(
  supabase: SupabaseClient,
  packageIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(packageIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from("deal_line_items")
    .select("quantity, fulfilment_cost_layer_id, deals!inner(stage)")
    .in("package_id", ids)
    .not("fulfilment_cost_layer_id", "is", null)
  if (error) throw new Error(error.message)

  for (const row of data ?? []) {
    const deal = Array.isArray(row.deals) ? row.deals[0] : row.deals
    const stage = typeof deal?.stage === "string" ? deal.stage : ""
    if (!SOLD_DEAL_STAGES.has(stage)) continue
    const layerId = typeof row.fulfilment_cost_layer_id === "string" ? row.fulfilment_cost_layer_id.trim() : ""
    if (!layerId) continue
    out.set(layerId, (out.get(layerId) ?? 0) + asInt(row.quantity))
  }
  return out
}

export async function loadClosedWonAndPortalSold(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const id = packageId.trim()
  if (!id) return 0
  let total = 0
  const ordersWithLines = new Set<string>()

  const { data: lines } = await supabase
    .from("order_line_items")
    .select("quantity, order_id, orders!inner(status)")
    .eq("package_id", id)
    .neq("orders.status", "cancelled")
  for (const row of lines ?? []) {
    if (typeof row.order_id === "string" && row.order_id) ordersWithLines.add(row.order_id)
    total += asInt(row.quantity)
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("id, guests")
    .eq("package_id", id)
    .neq("status", "cancelled")
  for (const row of orders ?? []) {
    if (typeof row.id === "string" && ordersWithLines.has(row.id)) continue
    total += asInt(row.guests)
  }

  const { data: dealLines } = await supabase
    .from("deal_line_items")
    .select("quantity, deals!inner(order_id, stage)")
    .eq("package_id", id)
  for (const row of dealLines ?? []) {
    const deal = Array.isArray(row.deals) ? row.deals[0] : row.deals
    if (!deal || deal.order_id) continue
    const stage = typeof deal.stage === "string" ? deal.stage : ""
    if (!SOLD_DEAL_STAGES.has(stage)) continue
    total += asInt(row.quantity)
  }

  return total
}

export type ApplyFulfilmentSoldResult = {
  ledgerPackageId: string
  layersUpdated: number
  inventoryAligned: boolean
}

/**
 * Move `quantity_remaining` onto the purchases that actually fulfil the deals,
 * so a leftover legacy layer can be deleted instead of showing as “sold”.
 */
export async function applyFulfilmentSoldToLayerRemaining(
  supabase: SupabaseClient,
  packageId: string,
): Promise<ApplyFulfilmentSoldResult> {
  const admin = createAdminClient() ?? supabase
  const ledger = await resolveLinkedStockLedger(admin, packageId)
  const ledgerPackageId = ledger.ledgerPackageId

  const siblingIds = [packageId.trim(), ledgerPackageId]
  const linkedGroup =
    !!ledger.groupId &&
    (ledger.usedParentLedger ||
      ledger.duration === "3_day" ||
      ledger.duration === "2_day" ||
      isLinkedSplitDuration(ledger.duration))
  if (linkedGroup && ledger.groupId) {
    const { data: siblings, error } = await admin
      .from("packages")
      .select("id")
      .eq("inventory_group_id", ledger.groupId)
      .is("shell_parent_package_id", null)
    if (error) throw new Error(error.message)
    siblingIds.push(...(siblings ?? []).map((row) => String(row.id)))
  }
  const packageIds = [...new Set(siblingIds.filter(Boolean))]

  const { data: layers, error: layerErr } = await admin
    .from("package_cost_layers")
    .select("id, package_id, quantity, quantity_remaining, received_at")
    .eq("package_id", ledgerPackageId)
  if (layerErr) throw new Error(layerErr.message)
  const pkgLayers = (layers ?? []).map((row) => ({
    id: String(row.id),
    package_id: String(row.package_id),
    quantity: asInt(row.quantity),
    quantity_remaining: asInt(row.quantity_remaining),
    received_at: row.received_at ? String(row.received_at) : null,
  }))
  if (pkgLayers.length === 0) {
    return { ledgerPackageId, layersUpdated: 0, inventoryAligned: false }
  }

  const fulfilmentSoldByLayer = await loadFulfilmentSoldByCostLayer(admin, packageIds)
  let totalPackageSold = 0
  for (const id of packageIds) {
    totalPackageSold += await loadClosedWonAndPortalSold(admin, id)
  }

  const soldByLayer = resolveSoldByCostLayer({
    layers: pkgLayers,
    fulfilmentSoldByLayer,
    totalPackageSold,
  })

  let layersUpdated = 0
  for (const layer of pkgLayers) {
    const nextRemaining = Math.max(0, layer.quantity - (soldByLayer.get(layer.id) ?? 0))
    if (nextRemaining === layer.quantity_remaining) continue
    const { error } = await admin
      .from("package_cost_layers")
      .update({ quantity_remaining: nextRemaining })
      .eq("id", layer.id)
    if (error) throw new Error(error.message)
    layer.quantity_remaining = nextRemaining
    layersUpdated += 1
  }

  const splitIds = await packageIdsOnSharedThreeDayLedger(admin, [ledgerPackageId])
  if (splitIds.has(ledgerPackageId)) {
    return { ledgerPackageId, layersUpdated, inventoryAligned: false }
  }

  const remaining = pkgLayers.reduce((sum, layer) => sum + layer.quantity_remaining, 0)
  const { data: inv, error: invErr } = await admin
    .from("package_inventory")
    .select("qty_available, qty_held")
    .eq("package_id", ledgerPackageId)
    .maybeSingle()
  if (invErr) throw new Error(invErr.message)
  if (!inv) return { ledgerPackageId, layersUpdated, inventoryAligned: false }

  const held = asInt(inv.qty_held)
  const nextAvailable = Math.max(held, remaining)
  if (nextAvailable === asInt(inv.qty_available)) {
    return { ledgerPackageId, layersUpdated, inventoryAligned: false }
  }
  const { error: availErr } = await admin
    .from("package_inventory")
    .update({ qty_available: nextAvailable })
    .eq("package_id", ledgerPackageId)
  if (availErr) throw new Error(availErr.message)
  return { ledgerPackageId, layersUpdated, inventoryAligned: true }
}
