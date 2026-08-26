"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { assignTakesToDealLines, collapseTakesBySupplier } from "@/lib/operations/stock"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { applyFulfilmentSoldToLayerRemaining } from "@/lib/inventory/fulfilment-layer-sold"

type Result = { ok: true; message: string } | { ok: false; message: string }

async function operationsGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  return { profile, supabase: await createClient(), admin: createAdminClient() }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected operations error."
}

export async function updateOrderOperations(input: {
  orderId: string
  fulfilmentStatus: string
  guestDetailsStatus: string
  communicationStatus: string
  supplierStatus: string
  deliveryStatus: string
  ownerProfileId?: string
  guestDetailsDueAt?: string
  supplierDueAt?: string
  deliveryDueAt?: string
  internalNotes?: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  try {
    const { error } = await gate.supabase.rpc("admin_update_order_operations", {
      p_order_id: input.orderId,
      p_fulfilment_status: input.fulfilmentStatus,
      p_guest_details_status: input.guestDetailsStatus,
      p_communication_status: input.communicationStatus,
      p_supplier_status: input.supplierStatus,
      p_delivery_status: input.deliveryStatus,
      p_owner_profile_id: input.ownerProfileId || null,
      p_guest_details_due_at: input.guestDetailsDueAt || null,
      p_supplier_due_at: input.supplierDueAt || null,
      p_delivery_due_at: input.deliveryDueAt || null,
      p_internal_notes: input.internalNotes ?? null,
    })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/operations")
    revalidatePath("/admin")
    return { ok: true, message: "Operations workflow updated." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function updateDealOperations(input: {
  dealId: string
  fulfilmentStatus: string
  guestDetailsStatus: string
  communicationStatus: string
  supplierStatus: string
  deliveryStatus: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const dealId = input.dealId.trim()
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return { ok: false, message: "Invalid deal." }
  try {
    const { error } = await gate.admin.from("deal_operations").upsert(
      {
        deal_id: dealId,
        fulfilment_status: input.fulfilmentStatus,
        guest_details_status: input.guestDetailsStatus,
        communication_status: input.communicationStatus,
        supplier_status: input.supplierStatus,
        delivery_status: input.deliveryStatus,
        updated_by: gate.profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" },
    )
    if (error) throw new Error(error.message)
    revalidatePath("/admin/operations")
    revalidatePath("/admin")
    return { ok: true, message: "Operations workflow updated." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

type GuestWrite = {
  orderId?: string | null
  dealId?: string | null
  guestId?: string
  fullName: string
  email?: string
  phone?: string
  nationality?: string
  dateOfBirth?: string
  dietaryRequirements?: string
  specialRequests?: string
  isLeadGuest: boolean
  detailsComplete?: boolean
  sortOrder: number
}

function guestPayload(input: GuestWrite) {
  const fullName = blank(input.fullName)
  return {
    full_name: fullName,
    email: blank(input.email)?.toLowerCase() ?? null,
    phone: blank(input.phone),
    nationality: blank(input.nationality),
    date_of_birth: blank(input.dateOfBirth),
    dietary_requirements: blank(input.dietaryRequirements),
    special_requests: blank(input.specialRequests),
    is_lead_guest: Boolean(input.isLeadGuest),
    details_complete: fullName ? input.detailsComplete !== false : false,
    sort_order: Math.max(0, input.sortOrder || 0),
    updated_at: new Date().toISOString(),
  }
}

async function bumpGuestStatusInProgress(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  profileId: string,
  target: { orderId: string | null; dealId: string | null },
) {
  if (target.orderId) {
    const { data } = await admin
      .from("order_operations")
      .select("guest_details_status")
      .eq("order_id", target.orderId)
      .maybeSingle()
    if ((data?.guest_details_status ?? "not_requested") === "not_requested") {
      await admin
        .from("order_operations")
        .update({
          guest_details_status: "partial",
          updated_by: profileId,
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", target.orderId)
    }
    return
  }
  if (!target.dealId) return
  const { data } = await admin
    .from("deal_operations")
    .select("guest_details_status, fulfilment_status, communication_status, supplier_status, delivery_status")
    .eq("deal_id", target.dealId)
    .maybeSingle()
  if ((data?.guest_details_status ?? "not_requested") !== "not_requested") return
  await admin.from("deal_operations").upsert(
    {
      deal_id: target.dealId,
      fulfilment_status: data?.fulfilment_status ?? "confirmed",
      guest_details_status: "partial",
      communication_status: data?.communication_status ?? "not_started",
      supplier_status: data?.supplier_status ?? "unassigned",
      delivery_status: data?.delivery_status ?? "not_ready",
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "deal_id" },
  )
}

function missingGuestsTable(message: string): boolean {
  return /deal_guests/i.test(message) || message.includes("42P01") || message.includes("PGRST205")
}

export async function saveOrderGuests(input: {
  orderId?: string | null
  dealId?: string | null
  guests: Array<Omit<GuestWrite, "orderId" | "dealId">>
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const orderId = blank(input.orderId)?.startsWith("deal:") ? null : blank(input.orderId)
  const dealId = blank(input.dealId)
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid order." }
  if (!orderId && (!dealId || !UUID_RE.test(dealId))) return { ok: false, message: "Invalid deal." }

  const named = input.guests.filter((guest) => blank(guest.fullName))
  if (!named.length) return { ok: false, message: "Enter at least one guest name." }

  let leadAssigned = false
  const rows = named.map((guest, index) => {
    const isLeadGuest = Boolean(guest.isLeadGuest) && !leadAssigned
    if (isLeadGuest) leadAssigned = true
    return {
      ...guest,
      isLeadGuest,
      sortOrder: Number.isInteger(guest.sortOrder) ? guest.sortOrder : index,
    }
  })
  if (!rows.some((row) => row.isLeadGuest) && rows[0]) {
    rows[0] = { ...rows[0], isLeadGuest: true }
  }

  const table = orderId ? "order_guests" : "deal_guests"
  const parent = orderId ? { order_id: orderId } : { deal_id: dealId! }
  const now = new Date().toISOString()

  try {
    const clear = gate.admin.from(table).update({ is_lead_guest: false, updated_at: now })
    const { error: clearError } = orderId
      ? await clear.eq("order_id", orderId).eq("is_lead_guest", true)
      : await clear.eq("deal_id", dealId!).eq("is_lead_guest", true)
    if (clearError) throw new Error(clearError.message)

    const toInsert: Array<Record<string, unknown>> = []
    for (const guest of rows) {
      const payload = guestPayload(guest)
      if (guest.guestId) {
        const update = gate.admin.from(table).update(payload).eq("id", guest.guestId)
        const { error } = orderId
          ? await update.eq("order_id", orderId)
          : await update.eq("deal_id", dealId!)
        if (error) throw new Error(error.message)
      } else {
        toInsert.push({ ...parent, ...payload })
      }
    }
    if (toInsert.length) {
      const { error } = await gate.admin.from(table).insert(toInsert)
      if (error) throw new Error(error.message)
    }

    await bumpGuestStatusInProgress(gate.admin, gate.profile.id, { orderId, dealId })
    revalidatePath("/admin/operations")
    revalidatePath("/admin/deals", "layout")
    if (dealId) revalidatePath(`/admin/deals/${dealId}`)
    return {
      ok: true,
      message: rows.length === 1 ? "Guest details saved." : `Saved ${rows.length} guests.`,
    }
  } catch (error) {
    const message = errorMessage(error)
    return {
      ok: false,
      message: missingGuestsTable(message)
        ? "Apply the deal_guests SQL in Supabase first, then save again."
        : message,
    }
  }
}

export async function saveOrderGuest(input: GuestWrite): Promise<Result> {
  return saveOrderGuests({
    orderId: input.orderId,
    dealId: input.dealId,
    guests: [input],
  })
}

export async function deleteOrderGuest(input: {
  orderId?: string | null
  dealId?: string | null
  guestId: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const orderId = blank(input.orderId)?.startsWith("deal:") ? null : blank(input.orderId)
  const dealId = blank(input.dealId)
  if (!UUID_RE.test(input.guestId)) return { ok: false, message: "Invalid guest." }
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, message: "Invalid order." }
  if (!orderId && (!dealId || !UUID_RE.test(dealId))) return { ok: false, message: "Invalid deal." }
  try {
    const table = orderId ? "order_guests" : "deal_guests"
    const del = gate.admin.from(table).delete().eq("id", input.guestId)
    const { error } = orderId
      ? await del.eq("order_id", orderId)
      : await del.eq("deal_id", dealId!)
    if (error) throw new Error(error.message)
    revalidatePath("/admin/operations")
    revalidatePath("/admin/deals", "layout")
    if (dealId) revalidatePath(`/admin/deals/${dealId}`)
    return { ok: true, message: "Guest removed." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

function stockReassignMessage(message: string): string {
  const value = message.toLowerCase()
  if (value.includes("forbidden")) return "Operations permission is required."
  if (value.includes("order_cancelled")) return "This order is cancelled."
  if (value.includes("order_not_found")) return "Order not found."
  if (value.includes("package_not_on_order")) return "That product is not on this order."
  if (value.includes("allocation_total")) return "Assigned places must equal the booking quantity."
  if (value.includes("insufficient_layer_remaining")) {
    return "That supplier no longer has enough remaining stock."
  }
  if (value.includes("allocation_locked")) {
    return "This supplier allocation is locked because fulfilment has been confirmed or tickets have been received."
  }
  if (value.includes("insufficient_purchased_stock")) {
    return "There is not enough purchased stock to assign this booking. Add a purchase order or mark the deal as brokered."
  }
  if (value.includes("invalid_cost_layer")) return "Choose a supplier that actually holds this stock."
  if (value.includes("could not find the function") || value.includes("does not exist")) {
    return "Apply the latest operations SQL in Supabase, then try again."
  }
  return message
}

export async function reassignDealPackageStock(input: {
  dealId: string
  packageId: string
  allocations: Array<{ costLayerId: string; quantity: number }>
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const dealId = input.dealId.trim()
  const packageId = input.packageId.trim()
  if (!UUID_RE.test(dealId)) return { ok: false, message: "Invalid deal." }
  if (!packageId) return { ok: false, message: "Choose a product." }

  const allocations = input.allocations
    .map((row) => ({
      costLayerId: row.costLayerId.trim(),
      quantity: Math.floor(Number(row.quantity)),
    }))
    .filter((row) => row.costLayerId && row.quantity > 0)
  if (allocations.some((row) => !UUID_RE.test(row.costLayerId))) {
    return { ok: false, message: "Choose a supplier that actually holds this stock." }
  }
  if (allocations.length === 0) return { ok: false, message: "Assign the booking quantity to a supplier." }

  try {
    const { data: deal, error: dealError } = await gate.admin
      .from("deals")
      .select("id, order_id")
      .eq("id", dealId)
      .maybeSingle()
    if (dealError) throw new Error(dealError.message)
    if (!deal) return { ok: false, message: "Deal not found." }
    if (deal.order_id) {
      return { ok: false, message: "This deal already has an order. Manage supplier from the order instead." }
    }

    const { data: lineRows, error: lineError } = await gate.admin
      .from("deal_line_items")
      .select("id, quantity")
      .eq("deal_id", dealId)
      .eq("package_id", packageId)
      .order("sort_order", { ascending: true })
    if (lineError) throw new Error(lineError.message)
    const lines = ((lineRows ?? []) as Array<{ id: string; quantity: number | null }>).map((row) => ({
      id: row.id,
      quantity: Number(row.quantity) || 0,
    }))
    if (lines.reduce((sum, line) => sum + Math.max(0, Math.floor(line.quantity)), 0) <= 0) {
      return { ok: false, message: "This deal has no products to allocate." }
    }

    const layerIds = [...new Set(allocations.map((row) => row.costLayerId))]
    const { data: layerRows, error: layerError } = await gate.admin
      .from("package_cost_layers")
      .select("id, supplier_id, purchase_order_id, unit_cost")
      .in("id", layerIds)
    if (layerError) throw new Error(layerError.message)
    const layers = (layerRows ?? []) as Array<{
      id: string
      supplier_id: string | null
      purchase_order_id: string | null
      unit_cost: number | string | null
    }>
    if (layers.length !== layerIds.length) {
      return { ok: false, message: "One of the selected suppliers is no longer available." }
    }

    const poIds = [...new Set(layers.map((layer) => layer.purchase_order_id).filter(Boolean))] as string[]
    const { data: poRows, error: poError } = poIds.length
      ? await gate.admin.from("purchase_orders").select("id, supplier_id").in("id", poIds)
      : { data: [] as Array<{ id: string; supplier_id: string | null }>, error: null }
    if (poError) throw new Error(poError.message)
    const supplierByPo = new Map(
      ((poRows ?? []) as Array<{ id: string; supplier_id: string | null }>).map((row) => [row.id, row.supplier_id]),
    )

    const mapping = assignTakesToDealLines(
      lines,
      collapseTakesBySupplier(
        allocations,
        layers.map((layer) => ({
          id: layer.id,
          supplierId:
            (layer.purchase_order_id
              ? supplierByPo.get(layer.purchase_order_id) ?? null
              : null) || layer.supplier_id,
        })),
      ),
    )
    if (!mapping.ok) return mapping

    const layerById = new Map(layers.map((layer) => [layer.id, layer]))
    const now = new Date().toISOString()
    for (const assignment of mapping.assignments) {
      const layer = layerById.get(assignment.costLayerId)
      if (!layer) return { ok: false, message: "One of the selected suppliers is no longer available." }
      const supplierId =
        (layer.purchase_order_id
          ? supplierByPo.get(layer.purchase_order_id) ?? null
          : null) || layer.supplier_id
      const { error: updateError } = await gate.admin
        .from("deal_line_items")
        .update({
          supplier_id: supplierId,
          fulfilment_cost_layer_id: layer.id,
          expected_unit_cost: layer.unit_cost == null ? null : Number(layer.unit_cost),
          updated_at: now,
        })
        .eq("id", assignment.lineId)
        .eq("deal_id", dealId)
      if (updateError) throw new Error(updateError.message)
    }

    try {
      await applyFulfilmentSoldToLayerRemaining(gate.admin ?? gate.supabase, packageId)
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Allocation saved, but remaining stock could not be updated.",
      }
    }

    revalidatePath("/admin/operations")
    revalidatePath("/admin/deals", "layout")
    revalidatePath("/admin/catalog", "layout")
    return { ok: true, message: "Supplier allocation saved." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function reassignOrderPackageStock(input: {
  orderId: string
  packageId: string
  allocations: Array<{ costLayerId: string; quantity: number }>
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(input.orderId)) return { ok: false, message: "Invalid order." }
  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Choose a product." }
  const allocations = input.allocations
    .map((row) => ({
      costLayerId: row.costLayerId.trim(),
      quantity: Math.floor(Number(row.quantity)),
    }))
    .filter((row) => row.costLayerId && row.quantity > 0)
  if (allocations.some((row) => !UUID_RE.test(row.costLayerId))) {
    return { ok: false, message: "Choose a supplier that actually holds this stock." }
  }
  if (allocations.length === 0) return { ok: false, message: "Assign the booking quantity to a supplier." }
  try {
    const { error } = await gate.supabase.rpc("admin_reassign_order_package_stock", {
      p_order_id: input.orderId,
      p_package_id: packageId,
      p_allocations: allocations.map((row) => ({
        cost_layer_id: row.costLayerId,
        quantity: row.quantity,
      })),
    })
    if (error) throw new Error(stockReassignMessage(error.message))
    revalidatePath("/admin/operations")
    revalidatePath("/admin/deals", "layout")
    return { ok: true, message: "Supplier allocation saved." }
  } catch (error) {
    return { ok: false, message: stockReassignMessage(errorMessage(error)) }
  }
}

export async function saveSupplierFulfilment(input: {
  id?: string
  orderId: string
  orderLineItemId?: string
  packageId: string
  supplierId?: string
  quantity: number
  status: string
  supplierReference?: string
  expectedAt?: string
  notes?: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  try {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error("Supplier quantity must be at least one.")
    }
    const payload = {
      order_id: input.orderId,
      order_line_item_id: input.orderLineItemId || null,
      package_id: input.packageId,
      supplier_id: input.supplierId || null,
      quantity: input.quantity,
      status: input.status,
      supplier_reference: input.supplierReference?.trim() || null,
      expected_at: input.expectedAt || null,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const operation = input.id
      ? gate.admin
          .from("order_supplier_fulfilments")
          .update(payload)
          .eq("id", input.id)
          .eq("order_id", input.orderId)
      : gate.admin.from("order_supplier_fulfilments").insert(payload)
    const { error } = await operation
    if (error) throw new Error(error.message)

    const { data: fulfilments } = await gate.admin
      .from("order_supplier_fulfilments")
      .select("status")
      .eq("order_id", input.orderId)
      .neq("status", "cancelled")
    const statuses = (fulfilments ?? []).map((row) => String(row.status))
    const summaryStatus = statuses.includes("issue")
      ? "issue"
      : statuses.length > 0 && statuses.every((value) => value === "tickets_received")
        ? "tickets_received"
        : statuses.length > 0 && statuses.every((value) => ["confirmed", "tickets_received"].includes(value))
          ? "confirmed"
          : statuses.length > 0
            ? "pending"
            : "unassigned"
    await gate.admin
      .from("order_operations")
      .update({
        supplier_status: summaryStatus,
        updated_by: gate.profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", input.orderId)
    await gate.admin.from("order_operation_events").insert({
      order_id: input.orderId,
      event_type: "supplier_fulfilment_saved",
      actor_profile_id: gate.profile.id,
      summary: "Updated supplier fulfilment",
      metadata: { status: input.status, supplier_id: input.supplierId || null },
    })
    revalidatePath("/admin/operations")
    return { ok: true, message: "Supplier fulfilment saved." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

