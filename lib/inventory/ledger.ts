import type { SupabaseClient } from "@supabase/supabase-js"
import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"

export type InventoryLedgerEntryType =
  | "purchase"
  | "adjustment"
  | "hold"
  | "hold_release"
  | "reservation"
  | "reservation_release"
  | "order_commit"
  | "order_cancel"
  | "opening_balance"
  | "sourcing_shortage"
  | "sourcing_clear"
  | "day_capacity_seed"

export type AppendLedgerInput = {
  packageId: string
  entryType: InventoryLedgerEntryType
  quantityDelta: number
  reason: string
  quantityAbsolute?: number | null
  poolId?: string | null
  sourceTable?: string | null
  sourceId?: string | null
  costLayerId?: string | null
  purchaseOrderId?: string | null
  supplierId?: string | null
  reservationId?: string | null
  dealId?: string | null
  metadata?: Record<string, unknown>
}

export async function appendInventoryLedger(
  supabase: SupabaseClient,
  input: AppendLedgerInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("admin_append_inventory_ledger", {
    p_package_id: input.packageId,
    p_entry_type: input.entryType,
    p_quantity_delta: Math.floor(input.quantityDelta),
    p_reason: input.reason,
    p_quantity_absolute: input.quantityAbsolute ?? null,
    p_pool_id: input.poolId ?? null,
    p_source_table: input.sourceTable ?? null,
    p_source_id: input.sourceId ?? null,
    p_cost_layer_id: input.costLayerId ?? null,
    p_purchase_order_id: input.purchaseOrderId ?? null,
    p_supplier_id: input.supplierId ?? null,
    p_reservation_id: input.reservationId ?? null,
    p_deal_id: input.dealId ?? null,
    p_metadata: input.metadata ?? {},
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, id: String(data) }
}

export type NativePackageAvailabilityRow = {
  package_id: string
  race_id: string
  name: string
  duration: string | null
  inventory_group_id: string | null
  inventory_pool_id: string | null
  shell_parent_package_id: string | null
  is_legacy_shell: boolean
  qty_available: number
  qty_held: number
  legacy_sellable: number
  layer_units_remaining: number
  active_reservations: number
  open_shortage_qty: number
}

export async function getNativePackageAvailability(
  packageIds?: readonly string[],
): Promise<NativePackageAvailabilityRow[]> {
  noStore()
  const supabase = await createClient()
  let query = supabase.from("native_package_availability").select("*")
  if (packageIds && packageIds.length > 0) {
    query = query.in("package_id", [...packageIds])
  }
  const { data, error } = await query
  if (error || !data) return []
  return data as NativePackageAvailabilityRow[]
}

/** Best-effort purchase ledger row after a cost layer is added. */
export async function recordPurchaseLedgerForLatestLayer(
  supabase: SupabaseClient,
  packageId: string,
  quantity: number,
  options?: {
    purchaseOrderId?: string | null
    supplierId?: string | null
    reason?: string
  },
): Promise<void> {
  const { data: layer } = await supabase
    .from("package_cost_layers")
    .select("id, purchase_order_id, supplier_id")
    .eq("package_id", packageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const layerId = layer?.id ? String(layer.id) : null
  const { data: pkg } = await supabase
    .from("packages")
    .select("inventory_pool_id")
    .eq("id", packageId)
    .maybeSingle()

  await appendInventoryLedger(supabase, {
    packageId,
    entryType: "purchase",
    quantityDelta: quantity,
    reason: options?.reason ?? "Stock purchase",
    poolId: (pkg as { inventory_pool_id?: string | null } | null)?.inventory_pool_id ?? null,
    sourceTable: layerId ? "package_cost_layers" : "package_inventory",
    sourceId: layerId ?? `${packageId}:purchase:${Date.now()}`,
    costLayerId: layerId,
    purchaseOrderId: options?.purchaseOrderId ?? (layer?.purchase_order_id as string | null) ?? null,
    supplierId: options?.supplierId ?? (layer?.supplier_id as string | null) ?? null,
  })
}
