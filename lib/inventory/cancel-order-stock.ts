import { createAdminClient } from "@/lib/supabase/admin"
import { prepareOrderCancelRelease } from "@/lib/inventory/prepare-order-cancel-release"

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23505" || Boolean(error?.message?.includes("duplicate key"))
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

export function postgresErrorText(error: {
  message?: string
  details?: string
  hint?: string
} | null | undefined): string {
  if (!error) return ""
  return [error.message, error.details, error.hint].filter(Boolean).join("\n")
}

export function shouldUseRestatementSafeOrderCancel(detail: string): boolean {
  return detail.includes("inventory_component_audit_rows_are_append_only")
}

export async function assertOrderCanBeCancelled(
  orderId: string,
): Promise<{ alreadyCancelled: boolean }> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data: order, error } = await admin
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!order) throw new Error("order_not_found")
  if (order.status === "cancelled") return { alreadyCancelled: true }

  const { data: invoices, error: invoiceError } = await admin
    .from("invoices")
    .select("status")
    .eq("order_id", orderId)
  if (invoiceError) throw new Error(invoiceError.message)
  if ((invoices ?? []).some((row) => row.status === "paid" || row.status === "delivered")) {
    throw new Error("paid_or_delivered_order_cannot_be_cancelled")
  }
  return { alreadyCancelled: false }
}

export async function orderCancelMustSkipCogsDelete(orderId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data: allocations, error: allocError } = await admin
    .from("inventory_allocations")
    .select("id, order_cost_consumption_id")
    .eq("order_id", orderId)
    .neq("state", "released")
  if (allocError) throw new Error(allocError.message)

  const allocationIds = (allocations ?? []).map((row) => row.id)
  const occIds = [
    ...new Set(
      (allocations ?? [])
        .map((row) => row.order_cost_consumption_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id)),
    ),
  ]
  if (occIds.length > 0) {
    const { data, error } = await admin
      .from("inventory_cost_restatement_events")
      .select("id")
      .in("order_cost_consumption_id", occIds)
      .limit(1)
    if (error) throw new Error(error.message)
    if (data && data.length > 0) return true
  }
  if (allocationIds.length > 0) {
    const { data, error } = await admin
      .from("inventory_cost_restatement_events")
      .select("id")
      .in("allocation_id", allocationIds)
      .limit(1)
    if (error) throw new Error(error.message)
    if (data && data.length > 0) return true
  }
  return false
}

async function recomputeDayRemainingFromCommittedHold(
  componentIds: string[],
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const ids = [...new Set(componentIds.filter(Boolean))]
  if (ids.length === 0) return

  const { data: components, error: componentError } = await admin
    .from("package_cost_layer_day_components")
    .select("id, quantity_total, quantity_remaining, cost_layer_id")
    .in("id", ids)
  if (componentError) throw new Error(componentError.message)

  const { data: dayRows, error: dayError } = await admin
    .from("inventory_allocation_day_components")
    .select("cost_layer_day_component_id, consumed_units, allocation_id")
    .in("cost_layer_day_component_id", ids)
  if (dayError) throw new Error(dayError.message)

  const allocationIds = [
    ...new Set((dayRows ?? []).map((row) => row.allocation_id).filter(Boolean)),
  ]
  const committed = new Set<string>()
  if (allocationIds.length > 0) {
    const { data: heldAllocations, error: heldError } = await admin
      .from("inventory_allocations")
      .select("id, state")
      .in("id", allocationIds)
    if (heldError) throw new Error(heldError.message)
    for (const row of heldAllocations ?? []) {
      if (row.state === "committed") committed.add(row.id)
    }
  }

  const heldByComponent = new Map<string, number>()
  for (const row of dayRows ?? []) {
    if (!committed.has(row.allocation_id)) continue
    heldByComponent.set(
      row.cost_layer_day_component_id,
      (heldByComponent.get(row.cost_layer_day_component_id) ?? 0) +
        Math.max(0, Math.floor(Number(row.consumed_units) || 0)),
    )
  }

  const layerIds = new Set<string>()
  for (const component of components ?? []) {
    const total = Math.max(0, Math.floor(Number(component.quantity_total) || 0))
    const held = heldByComponent.get(component.id) ?? 0
    const next = Math.max(0, Math.min(total, total - held))
    if (typeof component.cost_layer_id === "string" && component.cost_layer_id) {
      layerIds.add(component.cost_layer_id)
    }
    if (next === Math.floor(Number(component.quantity_remaining) || 0)) continue
    const { error } = await admin
      .from("package_cost_layer_day_components")
      .update({ quantity_remaining: next })
      .eq("id", component.id)
    if (error) throw new Error(error.message)
  }

  for (const layerId of layerIds) {
    const { error } = await admin.rpc("inventory_recompute_layer_remaining", {
      p_cost_layer_id: layerId,
    })
    if (error) throw new Error(error.message)
  }
}

/**
 * Restore cancelled-order stock without deleting compatibility COGS rows.
 * Deleting those rows SET NULLs append-only restatement events, which the
 * hosted DB still rejects. Day-component remaining is recomputed from
 * allocations that are still committed, so a retry cannot oversell.
 */
export async function releaseOrderStockSkippingRestatedCogs(
  orderId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  await prepareOrderCancelRelease(orderId)

  const { data: allocations, error: allocError } = await admin
    .from("inventory_allocations")
    .select("id, cost_layer_id, state, quantity, metadata")
    .eq("order_id", orderId)
    .neq("state", "released")
  if (allocError) throw new Error(allocError.message)

  const live = allocations ?? []
  const liveIds = live.map((row) => row.id)
  const { data: dayRows, error: dayError } = liveIds.length
    ? await admin
        .from("inventory_allocation_day_components")
        .select("allocation_id, cost_layer_day_component_id")
        .in("allocation_id", liveIds)
    : { data: [], error: null }
  if (dayError) throw new Error(dayError.message)

  const componentIds = [
    ...new Set(
      (dayRows ?? [])
        .map((row) => row.cost_layer_day_component_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id)),
    ),
  ]
  const allocationsWithDayComponents = new Set(
    (dayRows ?? []).map((row) => row.allocation_id),
  )

  const now = new Date().toISOString()
  for (const allocation of live) {
    const { error } = await admin
      .from("inventory_allocations")
      .update({
        state: "released",
        released_at: now,
        updated_at: now,
        order_cost_consumption_id: null,
        lock_state: "mutable",
        locked_at: null,
        locked_reason: null,
        metadata: {
          ...asMetadata(allocation.metadata),
          reason,
          restated_cogs_left_in_place: true,
        },
      })
      .eq("id", allocation.id)
      .neq("state", "released")
    if (error) throw new Error(error.message)
  }

  await recomputeDayRemainingFromCommittedHold(componentIds)

  const orphanLayers = [
    ...new Set(
      live
        .filter(
          (row) =>
            row.state === "committed" &&
            typeof row.cost_layer_id === "string" &&
            row.cost_layer_id &&
            !allocationsWithDayComponents.has(row.id),
        )
        .map((row) => row.cost_layer_id as string),
    ),
  ]
  for (const layerId of orphanLayers) {
    const { error } = await admin.rpc("inventory_recompute_layer_remaining", {
      p_cost_layer_id: layerId,
    })
    if (error) throw new Error(error.message)
  }
}

export async function finalizeNativeDealOrderCancel(input: {
  dealId: string
  orderId: string
  reason: string
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const reason = input.reason.trim()
  const now = new Date().toISOString()

  const { data: lines, error: lineError } = await admin
    .from("order_line_items")
    .select("package_id, quantity, sourcing_mode, deal_line_item_id")
    .eq("order_id", input.orderId)
    .order("sort_order", { ascending: true })
  if (lineError) throw new Error(lineError.message)

  for (const line of lines ?? []) {
    const packageId = String(line.package_id ?? "")
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
    if (!packageId || quantity <= 0) continue
    if ((line.sourcing_mode ?? "owned") === "owned") {
      const { error: ledgerError } = await admin.from("inventory_ledger_entries").insert({
        package_id: packageId,
        entry_type: "order_cancel",
        quantity_delta: quantity,
        reason,
        source_table: "orders",
        source_id: `${input.orderId}:${packageId}`,
        deal_id: input.dealId,
        metadata: {
          order_id: input.orderId,
          day_component_release: true,
        },
      })
      if (ledgerError && !isUniqueViolation(ledgerError)) throw new Error(ledgerError.message)
      if (!ledgerError) {
        const { error: availableError } = await admin.rpc("adjust_linked_inventory_available", {
          p_package_id: packageId,
          p_delta: quantity,
        })
        if (availableError) throw new Error(availableError.message)
      }
    } else if (line.deal_line_item_id) {
      const { data: shortage } = await admin
        .from("sourcing_shortages")
        .select("id, status, note")
        .eq("deal_line_item_id", line.deal_line_item_id)
        .maybeSingle()
      if (shortage?.id && shortage.status !== "purchased") {
        const { error: shortageError } = await admin
          .from("sourcing_shortages")
          .update({
            status: "cancelled",
            cleared_at: now,
            updated_at: now,
            note: [shortage.note, `Order cancelled: ${reason}`].filter(Boolean).join("\n"),
          })
          .eq("id", shortage.id)
        if (shortageError) throw new Error(shortageError.message)
      }
    }
  }

  const { data: fulfilments } = await admin
    .from("order_supplier_fulfilments")
    .select("id, notes")
    .eq("order_id", input.orderId)
    .neq("status", "tickets_received")
  for (const fulfilment of fulfilments ?? []) {
    const { error } = await admin
      .from("order_supplier_fulfilments")
      .update({
        status: "cancelled",
        updated_at: now,
        notes: [fulfilment.notes, `Order cancelled: ${reason}`].filter(Boolean).join("\n"),
      })
      .eq("id", fulfilment.id)
    if (error) throw new Error(error.message)
  }

  const { error: orderError } = await admin
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", input.orderId)
  if (orderError) throw new Error(orderError.message)

  const { error: invoiceError } = await admin
    .from("invoices")
    .update({
      status: "cancelled",
      cancelled_at: now,
      reconciliation_note: reason,
    })
    .eq("order_id", input.orderId)
  if (invoiceError) throw new Error(invoiceError.message)

  const { error: dealError } = await admin
    .from("deals")
    .update({
      stage: "cancelled",
      next_action: null,
      next_action_due_at: null,
      closed_at: now,
      updated_at: now,
    })
    .eq("id", input.dealId)
  if (dealError) throw new Error(dealError.message)

  const { error: activityError } = await admin.from("deal_activities").insert({
    deal_id: input.dealId,
    action: "order_cancelled",
    summary: reason,
    metadata: {
      order_id: input.orderId,
      xero_void_confirmed: true,
      day_component_release: true,
      restated_cogs_left_in_place: true,
    },
  })
  if (activityError) throw new Error(activityError.message)
}
