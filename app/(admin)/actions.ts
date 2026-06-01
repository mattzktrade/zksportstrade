"use server"

import { revalidatePath } from "next/cache"
import { revalidateAdminProfitPaths } from "@/lib/admin/revalidate-profit"
import { createClient } from "@/lib/supabase/server"
import { sanitizeHttpsUrl, sanitizeHttpsUrlList } from "@/lib/auth/safe-url"
import { deriveInventoryGroupId } from "@/lib/catalog/inventory-group"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"
import { isValidPackageDuration } from "@/lib/catalog/package-duration"
import { sendBookingApprovalRejectedEmail } from "@/lib/email/send-booking-approval-rejected"
import { sendOrderPlacedEmail } from "@/lib/email/send-order-placed"
import { getPortalProfile } from "@/lib/supabase/profile"
import { isInvoiceWorkflowStatus, normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"

type ActionResult = { ok: true } | { ok: false; message: string }

export async function requireAdminAction(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; message: string }
> {
  const profile = await getPortalProfile()
  if (!profile) return { ok: false, message: "Not signed in." }
  if (profile.role !== "admin") return { ok: false, message: "Admin access required." }
  const supabase = await createClient()
  return { ok: true, supabase }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function updateInvoiceStatus(
  invoiceId: string,
  status: InvoiceWorkflowStatus,
): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = invoiceId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid invoice id." }
  if (!isInvoiceWorkflowStatus(status)) return { ok: false, message: "Invalid status." }

  const { supabase } = gate

  const { data: current, error: fetchError } = await supabase
    .from("invoices")
    .select("status, issued_at")
    .eq("id", id)
    .maybeSingle()
  if (fetchError) return { ok: false, message: fetchError.message }
  if (!current) return { ok: false, message: "Invoice not found." }

  const previousStatus = normalizeInvoiceStatus(current.status)
  const patch: { status: InvoiceWorkflowStatus; issued_at?: string | null } = { status }

  if (
    (status === "awaiting_payment" || status === "paid") &&
    (previousStatus === "awaiting_invoice" || current.issued_at == null)
  ) {
    patch.issued_at = new Date().toISOString()
  }
  if (status === "awaiting_invoice") {
    patch.issued_at = null
  }

  const { error } = await supabase.from("invoices").update(patch).eq("id", id)
  if (error) return { ok: false, message: error.message }

  revalidatePath("/admin/agents")
  revalidatePath("/admin/orders")
  revalidatePath("/bookings")
  return { ok: true }
}

export async function setProfileApproval(
  profileId: string,
  approval_status: "approved" | "rejected",
  approval_note?: string | null,
): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate
  const note = approval_note?.trim() ? approval_note.trim() : null
  const { error } = await supabase
    .from("profiles")
    .update({ approval_status, approval_note: note, updated_at: new Date().toISOString() })
    .eq("id", profileId)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/pending-users")
  revalidatePath("/admin")
  revalidatePath("/admin/agents")
  return { ok: true }
}

export async function updatePackageFields(input: {
  packageId: string
  race_id: string
  name: string
  circuit: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  description: string
  image: string | null
  gallery_images: string[]
  currency: string
  total_capacity: number
  duration: string
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  is_hidden: boolean
  requires_booking_approval?: boolean
  sort_order: number
  brochure_url: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const duration = input.duration.trim()
  if (duration && !isValidPackageDuration(duration)) {
    return { ok: false, message: "Invalid package duration." }
  }
  const cap = Math.floor(Number(input.total_capacity))
  if (!Number.isFinite(cap) || cap < 0) return { ok: false, message: "Total capacity must be a non-negative whole number." }

  const brochure = sanitizeHttpsUrl(input.brochure_url)
  const image = sanitizeHttpsUrl(input.image)
  const gallery = sanitizeHttpsUrlList(input.gallery_images)
  const desc = input.description.trim()
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  const { data: existing, error: exErr } = await supabase.from("packages").select("race_id").eq("id", id).maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const raceId = input.race_id.trim()
  const inventoryGroupId = deriveInventoryGroupId(id, duration || null, raceId)
  const requiresBookingApproval =
    input.requires_booking_approval ?? isPaddockClubPackageName(input.name.trim())

  const { error } = await supabase
    .from("packages")
    .update({
      race_id: raceId,
      name: input.name.trim(),
      circuit: input.circuit.trim(),
      location: input.location.trim(),
      country: input.country.trim(),
      country_code: cc,
      event_date: input.event_date.trim(),
      date_range: input.date_range.trim(),
      description: desc,
      image,
      gallery_images: gallery,
      currency: (input.currency.trim() || "USD").slice(0, 8),
      total_capacity: cap,
      duration: duration || null,
      inventory_group_id: inventoryGroupId,
      requires_booking_approval: requiresBookingApproval,
      includes: input.includes,
      trade_price: input.trade_price,
      is_enquiry: input.is_enquiry,
      is_hidden: input.is_hidden,
      featured: input.featured,
      sort_order: Math.floor(Number(input.sort_order)) || 0,
      brochure_url: brochure,
    })
    .eq("id", id)

  if (error) return { ok: false, message: error.message }

  revalidatePackagePaths((existing as { race_id: string }).race_id, input.race_id.trim())
  return { ok: true }
}

export async function setPackageHidden(packageId: string, isHidden: boolean): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const { data: existing, error: exErr } = await supabase.from("packages").select("race_id").eq("id", id).maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const { error } = await supabase.from("packages").update({ is_hidden: isHidden }).eq("id", id)
  if (error) return { ok: false, message: error.message }

  revalidatePackagePaths((existing as { race_id: string }).race_id)
  return { ok: true }
}

function revalidatePackagePaths(...raceIds: string[]) {
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/")
  for (const rid of raceIds) {
    const r = rid?.trim()
    if (r) revalidatePath(`/packages/race/${r}`)
  }
}

export async function createPackage(input: {
  id: string
  race_id: string
  name: string
  circuit: string
  location: string
  country: string
  country_code: string
  event_date: string
  date_range: string
  description: string
  image: string | null
  gallery_images: string[]
  currency: string
  total_capacity: number
  duration: string
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  is_hidden?: boolean
  requires_booking_approval?: boolean
  sort_order: number
  brochure_url: string | null
  initial_qty_available: number
  initial_unit_cost: number | null
  initial_cost_note: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = input.id.trim().toLowerCase().replace(/\s+/g, "-")
  if (!/^[a-z0-9][a-z0-9-]{1,126}$/.test(id)) {
    return {
      ok: false,
      message: "Package id must be 2–127 characters: lowercase letters, numbers, and hyphens only (e.g. monaco-legend-2026).",
    }
  }

  const { data: dup } = await supabase.from("packages").select("id").eq("id", id).maybeSingle()
  if (dup) return { ok: false, message: "A package with this id already exists." }

  const { data: race, error: rErr } = await supabase.from("races").select("id").eq("id", input.race_id.trim()).maybeSingle()
  if (rErr) return { ok: false, message: rErr.message }
  if (!race) return { ok: false, message: "Race not found." }

  const duration = input.duration.trim()
  if (duration && !isValidPackageDuration(duration)) {
    return { ok: false, message: "Invalid package duration." }
  }
  const cap = Math.floor(Number(input.total_capacity))
  if (!Number.isFinite(cap) || cap < 0) return { ok: false, message: "Total capacity must be a non-negative whole number." }

  let qty = Math.floor(Number(input.initial_qty_available))
  if (!Number.isFinite(qty) || qty < 0) qty = 0

  let unitCost: number | null = null
  if (input.initial_unit_cost != null) {
    const c = Number(input.initial_unit_cost)
    if (!Number.isFinite(c) || c < 0) {
      return { ok: false, message: "Initial buy price must be a non-negative number." }
    }
    unitCost = c
  }

  const brochure = sanitizeHttpsUrl(input.brochure_url)
  const image = sanitizeHttpsUrl(input.image)
  const gallery = sanitizeHttpsUrlList(input.gallery_images)
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  const raceId = input.race_id.trim()
  const inventoryGroupId = deriveInventoryGroupId(id, duration || null, raceId)
  const requiresBookingApproval =
    input.requires_booking_approval ?? isPaddockClubPackageName(input.name.trim())

  const { error: insErr } = await supabase.from("packages").insert({
    id,
    race_id: raceId,
    name: input.name.trim(),
    circuit: input.circuit.trim(),
    location: input.location.trim(),
    country: input.country.trim(),
    country_code: cc,
    event_date: input.event_date.trim(),
    date_range: input.date_range.trim(),
    description: input.description.trim(),
    image,
    gallery_images: gallery,
    currency: (input.currency.trim() || "USD").slice(0, 8),
    total_capacity: cap,
    is_enquiry: input.is_enquiry,
    is_hidden: input.is_hidden ?? false,
    tier: "paddock",
    duration: duration || null,
    inventory_group_id: inventoryGroupId,
    requires_booking_approval: requiresBookingApproval,
    includes: input.includes,
    featured: input.featured,
    sort_order: Math.floor(Number(input.sort_order)) || 0,
    trade_price: input.trade_price,
    brochure_url: brochure,
  })

  if (insErr) return { ok: false, message: insErr.message }

  // Always create an empty inventory row; if there's initial stock, route it
  // through admin_add_cost_layer so qty_available and the cost layer move
  // together (and the COGS basis is recorded from day one).
  const { error: invErr } = await supabase.from("package_inventory").insert({
    package_id: id,
    qty_available: 0,
    qty_held: 0,
  })
  if (invErr) {
    await supabase.from("packages").delete().eq("id", id)
    return { ok: false, message: invErr.message }
  }

  if (inventoryGroupId) {
    const { data: siblings } = await supabase
      .from("packages")
      .select("id, duration")
      .eq("inventory_group_id", inventoryGroupId)
      .neq("id", id)
    const siblingIds = (siblings ?? []).map((s) => s.id)
    if (siblingIds.length > 0) {
      const { data: invRows } = await supabase
        .from("package_inventory")
        .select("package_id, qty_available")
        .in("package_id", siblingIds)
      const invBy = new Map((invRows ?? []).map((r) => [r.package_id, r.qty_available]))
      const sat = (siblings ?? []).find((s) => s.duration === "saturday_only")
      const sun = (siblings ?? []).find((s) => s.duration === "sunday_only")
      const twoDay = (siblings ?? []).find((s) => s.duration === "2_day")
      const dur = duration || ""
      let seedQty: number | null = null
      if (dur === "saturday_only" || dur === "sunday_only") {
        const peer = (siblings ?? []).find((s) => s.duration === dur)
        if (peer) seedQty = invBy.get(peer.id) ?? null
        else if (dur === "sunday_only" && sat) seedQty = invBy.get(sat.id) ?? null
        else if (dur === "saturday_only" && sun) seedQty = invBy.get(sun.id) ?? null
        else if (twoDay) seedQty = invBy.get(twoDay.id) ?? null
      } else if (dur === "2_day") {
        const caps = [sat, sun].map((s) => (s ? invBy.get(s.id) : null)).filter((n): n is number => n != null)
        if (caps.length > 0) seedQty = Math.min(...caps)
      }
      if (seedQty != null) {
        await supabase.from("package_inventory").update({ qty_available: seedQty }).eq("package_id", id)
        qty = 0
      }
      await supabase.rpc("reconcile_linked_multi_day_inventory", { p_group_id: inventoryGroupId })
    }
  }

  if (qty > 0) {
    const cost = unitCost ?? 0
    const note = unitCost != null
      ? (input.initial_cost_note?.trim() || "Initial stock")
      : "Initial stock — buy price not yet recorded"
    const { error: layerErr } = await supabase.rpc("admin_add_cost_layer", {
      p_package_id: id,
      p_quantity: qty,
      p_unit_cost: cost,
      p_currency: input.currency.trim() || "USD",
      p_note: note,
      p_received_at: null,
    })
    if (layerErr) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return { ok: false, message: layerErr.message }
    }
  }

  revalidatePackagePaths(input.race_id.trim())
  revalidatePath("/admin")
  return { ok: true }
}

export async function updateInventoryRow(input: {
  packageId: string
  qty_available: number
  qty_held: number
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { qty_available, qty_held, packageId } = input
  if (!Number.isInteger(qty_available) || !Number.isInteger(qty_held)) {
    return { ok: false, message: "Quantities must be whole numbers." }
  }
  if (qty_available < 0 || qty_held < 0) {
    return { ok: false, message: "Quantities cannot be negative." }
  }
  if (qty_held > qty_available) {
    return { ok: false, message: "Held quantity cannot exceed available capacity." }
  }
  const { supabase } = gate

  const { error } = await supabase
    .from("package_inventory")
    .update({ qty_available, qty_held })
    .eq("package_id", packageId)
  if (error) return { ok: false, message: error.message }

  const { data: pkg } = await supabase
    .from("packages")
    .select("inventory_group_id")
    .eq("id", packageId)
    .maybeSingle()
  if (pkg?.inventory_group_id) {
    await supabase.rpc("reconcile_linked_multi_day_inventory", { p_group_id: pkg.inventory_group_id })
  }
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}

export async function createInventoryHold(input: {
  packageId: string
  agentProfileId: string
  quantity: number
  note?: string | null
  /** Hours until auto-release if not checked out (default 24). */
  holdHours?: number
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const q = Math.floor(Number(input.quantity))
  if (!Number.isFinite(q) || q <= 0) {
    return { ok: false, message: "Quantity must be a positive number." }
  }
  const hours = Math.floor(Number(input.holdHours ?? 24))
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
    return { ok: false, message: "Hold duration must be between 1 and 720 hours." }
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_create_hold", {
    p_package_id: input.packageId,
    p_agent_profile_id: input.agentProfileId,
    p_quantity: q,
    p_note: input.note ?? null,
    p_hold_hours: hours,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}

export async function releaseInventoryHold(holdId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_release_hold", { p_hold_id: holdId })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}

export async function addCostLayer(input: {
  packageId: string
  quantity: number
  unitCost: number
  currency?: string | null
  note?: string | null
  receivedAt?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const q = Math.floor(Number(input.quantity))
  if (!Number.isFinite(q) || q <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number." }
  }
  const c = Number(input.unitCost)
  if (!Number.isFinite(c) || c < 0) {
    return { ok: false, message: "Unit cost must be a non-negative number." }
  }
  let received: string | null = null
  if (input.receivedAt && input.receivedAt.trim()) {
    const d = new Date(input.receivedAt)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Received date is not a valid date." }
    }
    received = d.toISOString()
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_add_cost_layer", {
    p_package_id: input.packageId,
    p_quantity: q,
    p_unit_cost: c,
    p_currency: input.currency?.trim() || null,
    p_note: input.note ?? null,
    p_received_at: received,
  })
  if (error) return { ok: false, message: error.message }
  revalidateAdminProfitPaths(input.packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/")
  const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
    p_package_id: input.packageId,
  })
  if (bfErr) return { ok: false, message: bfErr.message }
  return { ok: true }
}

export async function updateCostLayer(input: {
  layerId: string
  packageId?: string | null
  unitCost?: number | null
  currency?: string | null
  note?: string | null
  receivedAt?: string | null
  cascadeToConsumptions?: boolean
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(input.layerId.trim())) {
    return { ok: false, message: "Invalid cost layer id." }
  }
  let cost: number | null = null
  if (input.unitCost != null) {
    const c = Number(input.unitCost)
    if (!Number.isFinite(c) || c < 0) {
      return { ok: false, message: "Unit cost must be a non-negative number." }
    }
    cost = c
  }
  let received: string | null = null
  if (input.receivedAt && input.receivedAt.trim()) {
    const d = new Date(input.receivedAt)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Received date is not a valid date." }
    }
    received = d.toISOString()
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_update_cost_layer", {
    p_layer_id: input.layerId.trim(),
    p_unit_cost: cost,
    p_currency: input.currency?.trim() || null,
    p_note: input.note ?? null,
    p_received_at: received,
    p_cascade_to_consumptions: input.cascadeToConsumptions ?? true,
  })
  if (error) return { ok: false, message: error.message }
  revalidateAdminProfitPaths(input.packageId?.trim() || undefined)
  revalidatePath("/admin/inventory")
  return { ok: true }
}

export async function updateCostLayerQuantity(input: {
  layerId: string
  packageId?: string | null
  quantity: number
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(input.layerId.trim())) {
    return { ok: false, message: "Invalid cost layer id." }
  }
  const q = Math.floor(Number(input.quantity))
  if (!Number.isFinite(q) || q < 0) {
    return { ok: false, message: "Quantity must be a non-negative whole number." }
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_update_cost_layer_quantity", {
    p_layer_id: input.layerId.trim(),
    p_new_quantity: q,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("quantity_below_consumed")) {
      return {
        ok: false,
        message: "Quantity cannot be less than the units already sold from this layer.",
      }
    }
    if (m.includes("would_drop_below_holds")) {
      return {
        ok: false,
        message: "Reducing quantity would drop available stock below active holds. Release holds first.",
      }
    }
    if (m.includes("inventory_negative")) {
      return { ok: false, message: "Reducing quantity would make available stock negative." }
    }
    return { ok: false, message: error.message }
  }
  revalidateAdminProfitPaths(input.packageId?.trim() || undefined)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}

export async function deleteCostLayer(layerId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(layerId.trim())) {
    return { ok: false, message: "Invalid cost layer id." }
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_delete_cost_layer", { p_layer_id: layerId.trim() })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}

export async function deletePackage(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const { supabase } = gate

  const { data: pkg, error: pkgErr } = await supabase.from("packages").select("id, race_id").eq("id", id).maybeSingle()
  if (pkgErr) return { ok: false, message: pkgErr.message }
  if (!pkg) return { ok: false, message: "Package not found." }

  const { count, error: orderErr } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("package_id", id)
  if (orderErr) return { ok: false, message: orderErr.message }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Cannot delete: ${count} order${count === 1 ? "" : "s"} reference this package. Cancel or keep the package for records.`,
    }
  }

  const { error } = await supabase.from("packages").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }

  const raceId = (pkg as { race_id: string }).race_id
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/orders")
  revalidatePath("/admin")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath(`/packages/race/${raceId}`)
  return { ok: true }
}

export async function approveBookingRequest(
  requestId: string,
): Promise<ActionResult & { orderReference?: string }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(requestId.trim())) {
    return { ok: false, message: "Invalid request id." }
  }

  const { supabase } = gate
  const { data: req, error: reqErr } = await supabase
    .from("booking_approval_requests")
    .select("*")
    .eq("id", requestId.trim())
    .maybeSingle()

  if (reqErr) return { ok: false, message: reqErr.message }
  if (!req) return { ok: false, message: "Request not found." }
  if (req.status !== "pending") {
    return { ok: false, message: "This request has already been reviewed." }
  }

  const { data: agent, error: agentErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", req.agent_profile_id)
    .maybeSingle()
  if (agentErr || !agent) return { ok: false, message: "Agent profile not found." }

  const { data, error } = await supabase.rpc("admin_approve_booking_request", {
    p_request_id: requestId.trim(),
  })
  if (error) return { ok: false, message: error.message }

  const row = data as Record<string, unknown> | null
  const orderReference = typeof row?.order_reference === "string" ? row.order_reference : undefined
  if (!orderReference) {
    return { ok: false, message: "Order was created but the reference was missing from the response." }
  }

  const emailResult = await sendOrderPlacedEmail({
    agentEmail: agent.email,
    agentName: agent.full_name || agent.email.split("@")[0] || "Partner",
    orderReference,
    packageName: String(row?.package_name ?? ""),
    circuit: String(row?.circuit ?? ""),
    guests: Number(row?.guests ?? req.guests),
    totalAmount: Number(row?.total_amount ?? req.total_amount),
    currency: String(row?.currency ?? req.currency),
    clientName: req.client_name,
    clientEmail: req.client_email,
    clientPhone: req.client_phone,
    clientNationality: req.client_nationality ?? "",
    poNumber: req.po_number,
    dietary: req.dietary_requirements,
    specialRequests: req.special_requests,
    shippingAddressLine1: req.shipping_address_line1,
    shippingAddressLine2: req.shipping_address_line2,
    shippingCity: req.shipping_city,
    shippingPostcode: req.shipping_postcode,
    shippingCountry: req.shipping_country,
    billingAddressLine1: req.billing_address_line1,
    billingAddressLine2: req.billing_address_line2,
    billingCity: req.billing_city,
    billingPostcode: req.billing_postcode,
    billingCountry: req.billing_country,
  })

  if (!emailResult.ok) {
    console.error("[approveBookingRequest] order created but email failed:", emailResult.error ?? emailResult.skipped)
  }

  revalidatePath("/admin/booking-requests")
  revalidatePath("/admin/orders")
  revalidatePath("/bookings")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  return { ok: true, orderReference }
}

export async function rejectBookingRequest(
  requestId: string,
  note: string | null,
): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(requestId.trim())) {
    return { ok: false, message: "Invalid request id." }
  }

  const { supabase } = gate
  const { data: req, error: reqErr } = await supabase
    .from("booking_approval_requests")
    .select("id, status, reference, agent_profile_id, package_id")
    .eq("id", requestId.trim())
    .maybeSingle()

  if (reqErr) return { ok: false, message: reqErr.message }
  if (!req) return { ok: false, message: "Request not found." }
  if (req.status !== "pending") {
    return { ok: false, message: "This request has already been reviewed." }
  }

  const { data: agent } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", req.agent_profile_id)
    .maybeSingle()

  const { data: pkg } = await supabase
    .from("packages")
    .select("name, circuit")
    .eq("id", req.package_id)
    .maybeSingle()

  const { error } = await supabase.rpc("admin_reject_booking_request", {
    p_request_id: requestId.trim(),
    p_note: note?.trim() || null,
  })
  if (error) return { ok: false, message: error.message }

  if (agent?.email) {
    await sendBookingApprovalRejectedEmail({
      agentEmail: agent.email,
      agentName: agent.full_name || agent.email.split("@")[0] || "Partner",
      requestReference: req.reference,
      packageName: pkg?.name ?? "Package",
      circuit: pkg?.circuit ?? "",
      rejectionNote: note?.trim() || null,
    })
  }

  revalidatePath("/admin/booking-requests")
  revalidatePath("/bookings")
  return { ok: true }
}

export async function insertPackageInventory(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate
  const { error } = await supabase.from("package_inventory").insert({
    package_id: packageId,
    qty_available: 0,
    qty_held: 0,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  return { ok: true }
}
