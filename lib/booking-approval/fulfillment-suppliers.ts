import type { SupabaseClient } from "@supabase/supabase-js"

export type BookingFulfillmentSupplierOption = {
  /** Cost layer id, or empty string for automatic allocation. */
  costLayerId: string
  label: string
  remaining: number
  /** True when this layer alone can cover the requested guest count. */
  canCover: boolean
}

type LayerRow = {
  id: string
  package_id: string
  quantity_remaining: number
  source: string | null
  received_at: string | null
  purchase_order_id: string | null
  fulfilment_block_id: string | null
}

/**
 * Supplier / stock-purchase options for fulfilling a booking on this package's
 * cost ledger (includes linked 3-day parent layers when the day package has none).
 */
export async function getBookingFulfillmentSupplierOptions(
  admin: SupabaseClient,
  packageId: string,
  guests: number,
): Promise<BookingFulfillmentSupplierOption[]> {
  const pkgId = packageId.trim()
  const qty = Math.max(0, Math.floor(guests))
  if (!pkgId) return [{ costLayerId: "", label: "Automatic (prefer single supplier)", remaining: 0, canCover: true }]

  let ledgerId = pkgId
  try {
    const { data: resolved } = await admin.rpc("resolve_cost_ledger_package_id", {
      p_package_id: pkgId,
    })
    if (typeof resolved === "string" && resolved.trim()) ledgerId = resolved.trim()
  } catch {
    // Fall back to the package's own layers if the RPC is not deployed yet.
  }

  const { data: layers } = await admin
    .from("package_cost_layers")
    .select(
      "id, package_id, quantity_remaining, source, received_at, purchase_order_id, fulfilment_block_id",
    )
    .eq("package_id", ledgerId)
    .gt("quantity_remaining", 0)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })

  const rows = (layers ?? []) as LayerRow[]
  const poIds = [
    ...new Set(rows.map((r) => r.purchase_order_id).filter((id): id is string => !!id)),
  ]
  const blockIds = [
    ...new Set(rows.map((r) => r.fulfilment_block_id).filter((id): id is string => !!id)),
  ]

  const poById = new Map<string, { po_number: string; supplier: string }>()
  if (poIds.length > 0) {
    const { data: pos } = await admin
      .from("purchase_orders")
      .select("id, po_number, supplier")
      .in("id", poIds)
    for (const po of pos ?? []) {
      poById.set(String(po.id), {
        po_number: String(po.po_number ?? ""),
        supplier: String(po.supplier ?? ""),
      })
    }
  }

  const blockById = new Map<string, string>()
  if (blockIds.length > 0) {
    const { data: blocks } = await admin.from("fulfilment_blocks").select("id, name").in("id", blockIds)
    for (const b of blocks ?? []) {
      blockById.set(String(b.id), String(b.name ?? ""))
    }
  }

  const options: BookingFulfillmentSupplierOption[] = [
    {
      costLayerId: "",
      label: "Automatic (prefer single supplier / suite)",
      remaining: rows.reduce((sum, r) => sum + Math.max(0, Math.floor(r.quantity_remaining)), 0),
      canCover: true,
    },
  ]

  for (const layer of rows) {
    const remaining = Math.max(0, Math.floor(Number(layer.quantity_remaining) || 0))
    if (remaining <= 0) continue
    const po = layer.purchase_order_id ? poById.get(layer.purchase_order_id) : null
    const blockName = layer.fulfilment_block_id ? blockById.get(layer.fulfilment_block_id) : null
    const supplier =
      po?.supplier?.trim() ||
      layer.source?.trim() ||
      "Unassigned"
    const parts = [supplier]
    if (po?.po_number?.trim()) parts.push(po.po_number.trim())
    if (blockName?.trim()) parts.push(blockName.trim())
    parts.push(`${remaining} left`)
    options.push({
      costLayerId: layer.id,
      label: parts.join(" · "),
      remaining,
      canCover: qty <= 0 || remaining >= qty,
    })
  }

  return options
}
