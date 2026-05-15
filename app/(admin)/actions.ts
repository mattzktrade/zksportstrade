"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { sanitizeHttpsUrl, sanitizeHttpsUrlList } from "@/lib/auth/safe-url"
import { getPortalProfile } from "@/lib/supabase/profile"
import { isInvoiceWorkflowStatus, normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"

type ActionResult = { ok: true } | { ok: false; message: string }

async function requireAdminAction(): Promise<
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
  revalidatePath("/invoices")
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
  tier: string
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  sort_order: number
  brochure_url: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const tier = ["paddock", "champions", "legend", "hero"].includes(input.tier) ? input.tier : "paddock"
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

  const { error } = await supabase
    .from("packages")
    .update({
      race_id: input.race_id.trim(),
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
      tier,
      includes: input.includes,
      trade_price: input.trade_price,
      is_enquiry: input.is_enquiry,
      featured: input.featured,
      sort_order: Math.floor(Number(input.sort_order)) || 0,
      brochure_url: brochure,
    })
    .eq("id", id)

  if (error) return { ok: false, message: error.message }

  const prevRace = (existing as { race_id: string }).race_id
  const nextRace = input.race_id.trim()
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath(`/packages/race/${prevRace}`)
  if (nextRace !== prevRace) revalidatePath(`/packages/race/${nextRace}`)
  return { ok: true }
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
  tier: string
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  sort_order: number
  brochure_url: string | null
  initial_qty_available: number
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

  const tier = ["paddock", "champions", "legend", "hero"].includes(input.tier) ? input.tier : "paddock"
  const cap = Math.floor(Number(input.total_capacity))
  if (!Number.isFinite(cap) || cap < 0) return { ok: false, message: "Total capacity must be a non-negative whole number." }

  let qty = Math.floor(Number(input.initial_qty_available))
  if (!Number.isFinite(qty) || qty < 0) qty = 0

  const brochure = sanitizeHttpsUrl(input.brochure_url)
  const image = sanitizeHttpsUrl(input.image)
  const gallery = sanitizeHttpsUrlList(input.gallery_images)
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  const { error: insErr } = await supabase.from("packages").insert({
    id,
    race_id: input.race_id.trim(),
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
    tier,
    includes: input.includes,
    featured: input.featured,
    sort_order: Math.floor(Number(input.sort_order)) || 0,
    trade_price: input.trade_price,
    brochure_url: brochure,
  })

  if (insErr) return { ok: false, message: insErr.message }

  const { error: invErr } = await supabase.from("package_inventory").insert({
    package_id: id,
    qty_available: qty,
    qty_held: 0,
  })
  if (invErr) {
    await supabase.from("packages").delete().eq("id", id)
    return { ok: false, message: invErr.message }
  }

  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath(`/packages/race/${input.race_id.trim()}`)
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
