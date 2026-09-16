"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { setPurchaseOrderNote, setPurchaseOrderOpsDates } from "@/lib/admin/purchase-orders"
import {
  applyOpsSupplierNoteToPurchaseOrder,
  clientDeliveryNeedsDetails,
  lockedClientDelivery,
  parseClientDeliveryMethod,
  parseSupplierFulfilmentMethod,
  supplierNeedsNamesSent,
  supplierNeedsTicketsIn,
} from "@/lib/operations/fulfilment"
import { syncDealWorkflowFromOperations } from "@/lib/operations/sync-deal-workflow"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string } | { ok: false; message: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DELIVERY_PROOF_BUCKET = "order-delivery-proofs"
const DELIVERY_PROOF_MAX_BYTES = 10 * 1024 * 1024
const DELIVERY_PROOF_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"])

async function operationsGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  return { profile, supabase: await createClient(), admin: createAdminClient() }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected operations error."
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function revalidateOps(dealId?: string | null) {
  revalidatePath("/admin/operations")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin")
  revalidatePath("/admin/deals", "layout")
  revalidatePath("/bookings")
  revalidatePath("/invoices")
  if (dealId) revalidatePath(`/admin/deals/${dealId}`)
}

function missingColumn(message: string): boolean {
  return /supplier_fulfilment_method|client_delivery_method|thank_you_skipped|operations_contact_id|deal_id|supplier_notes/i.test(
    message,
  )
}

function cleanProofFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120)
  return cleaned || "delivery-proof"
}

async function currentOps(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orderId: string | null,
  dealId: string | null,
) {
  if (orderId) {
    const { data } = await admin
      .from("order_operations")
      .select(
        "fulfilment_status, guest_details_status, communication_status, supplier_status, delivery_status, supplier_fulfilment_method, client_delivery_method",
      )
      .eq("order_id", orderId)
      .maybeSingle()
    if (data) return data
  }
  if (dealId) {
    const { data } = await admin
      .from("deal_operations")
      .select(
        "fulfilment_status, guest_details_status, communication_status, supplier_status, delivery_status, supplier_fulfilment_method, client_delivery_method",
      )
      .eq("deal_id", dealId)
      .maybeSingle()
    if (data) return data
  }
  return null
}

async function writeOpsPatch(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  profileId: string,
  orderId: string | null,
  dealId: string | null,
  patch: Record<string, unknown>,
) {
  const now = new Date().toISOString()
  const payload = { ...patch, updated_by: profileId, updated_at: now }
  if (orderId) {
    const { data: existing } = await admin.from("order_operations").select("order_id").eq("order_id", orderId).maybeSingle()
    const { error } = existing
      ? await admin.from("order_operations").update(payload).eq("order_id", orderId)
      : await admin.from("order_operations").insert({ order_id: orderId, ...payload })
    if (error) throw new Error(error.message)
  }
  if (dealId) {
    const current = await currentOps(admin, null, dealId)
    const { error } = await admin.from("deal_operations").upsert(
      {
        deal_id: dealId,
        fulfilment_status: current?.fulfilment_status ?? "confirmed",
        guest_details_status: current?.guest_details_status ?? "not_requested",
        communication_status: current?.communication_status ?? "not_started",
        supplier_status: current?.supplier_status ?? "unassigned",
        delivery_status: current?.delivery_status ?? "not_ready",
        ...payload,
      },
      { onConflict: "deal_id" },
    )
    if (error) throw new Error(error.message)
  }
}

function bookingIds(input: { orderId?: string | null; dealId?: string | null }):
  | { ok: true; orderId: string | null; dealId: string | null }
  | { ok: false; error: string } {
  const rawOrder = blank(input.orderId)
  const orderId = rawOrder?.startsWith("deal:") ? null : rawOrder
  const dealId = blank(input.dealId)
  if (orderId && !UUID_RE.test(orderId)) return { ok: false, error: "Invalid order." }
  if (dealId && !UUID_RE.test(dealId)) return { ok: false, error: "Invalid deal." }
  if (!orderId && !dealId) return { ok: false, error: "Choose a booking." }
  return { ok: true, orderId, dealId }
}

async function invoiceIdForOrder(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orderId: string | null,
): Promise<string | null> {
  if (!orderId) return null
  const { data } = await admin
    .from("invoices")
    .select("id")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ? String(data.id) : null
}

async function hasDeliveryProof(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orderId: string | null,
  dealId: string | null,
): Promise<boolean> {
  if (orderId) {
    const { data } = await admin.from("order_delivery_proofs").select("id").eq("order_id", orderId).limit(1).maybeSingle()
    if (data?.id) return true
  }
  if (dealId) {
    const { data, error } = await admin.from("order_delivery_proofs").select("id").eq("deal_id", dealId).limit(1).maybeSingle()
    if (!error && data?.id) return true
  }
  return false
}

export async function saveOperationsContact(input: {
  dealId: string
  contactId: string | null
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(input.dealId)) return { ok: false, message: "Invalid deal." }
  const contactId = blank(input.contactId)
  if (contactId && !UUID_RE.test(contactId)) return { ok: false, message: "Invalid contact." }
  const { error } = await gate.admin
    .from("deals")
    .update({ operations_contact_id: contactId, updated_at: new Date().toISOString() })
    .eq("id", input.dealId)
  if (error) {
    return {
      ok: false,
      message: missingColumn(error.message)
        ? "Apply the latest operations SQL in Supabase first, then try again."
        : error.message,
    }
  }
  revalidateOps(input.dealId)
  return { ok: true, message: "Operations contact saved." }
}

export async function addOperationsContact(input: {
  dealId: string
  accountId: string
  fullName: string
  email?: string | null
  phone?: string | null
  jobTitle?: string | null
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  if (!UUID_RE.test(input.dealId) || !UUID_RE.test(input.accountId)) {
    return { ok: false, message: "Invalid deal or account." }
  }
  const fullName = blank(input.fullName)
  if (!fullName) return { ok: false, message: "Enter the operations contact name." }
  const email = blank(input.email)?.toLowerCase() ?? null
  if (email && !EMAIL_RE.test(email)) return { ok: false, message: "Enter a valid email." }
  const { data, error } = await gate.admin
    .from("crm_contacts")
    .insert({
      account_id: input.accountId,
      full_name: fullName,
      email,
      phone: blank(input.phone),
      job_title: blank(input.jobTitle),
      is_primary: false,
      active: true,
    })
    .select("id")
    .maybeSingle()
  if (error || !data?.id) return { ok: false, message: error?.message ?? "Could not add the contact." }
  return saveOperationsContact({ dealId: input.dealId, contactId: String(data.id) })
}

export async function saveFulfilmentPlan(input: {
  orderId?: string | null
  dealId?: string | null
  supplierFulfilmentMethod: string | null
  clientDeliveryMethod: string | null
  collectionPoint?: string | null
  collectionTime?: string | null
  contactOnSite?: string | null
  deliveryDueAt?: string | null
  supplierNotes?: string | null
  internalNotes?: string | null
  purchaseOrderIds?: string[]
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const ids = bookingIds(input)
  if (!ids.ok) return { ok: false, message: ids.error }
  const supplier = parseSupplierFulfilmentMethod(input.supplierFulfilmentMethod)
  const client = lockedClientDelivery(supplier) ?? parseClientDeliveryMethod(input.clientDeliveryMethod)
  const details = clientDeliveryNeedsDetails(client)
  const supplierNotes = blank(input.supplierNotes)
  try {
    await writeOpsPatch(gate.admin, gate.profile.id, ids.orderId, ids.dealId, {
      supplier_fulfilment_method: supplier,
      client_delivery_method: client,
      collection_point: details ? blank(input.collectionPoint) : null,
      collection_time: details ? blank(input.collectionTime) : null,
      contact_on_site: details ? blank(input.contactOnSite) : null,
      delivery_due_at: details ? blank(input.deliveryDueAt) : null,
      supplier_notes: supplierNotes,
      ...(input.internalNotes !== undefined ? { internal_notes: blank(input.internalNotes) } : {}),
      ...(supplier === "names_only" ? { supplier_status: "not_required" } : {}),
    })
    const poIds = [...new Set((input.purchaseOrderIds ?? []).filter((id) => UUID_RE.test(id)))]
    if (poIds.length > 0) {
      const { data: purchaseOrders, error: poLoadError } = await gate.admin
        .from("purchase_orders")
        .select("id, note")
        .in("id", poIds)
      if (poLoadError) {
        revalidateOps(ids.dealId)
        return {
          ok: false,
          message: `Fulfilment plan saved, but purchase orders could not be updated: ${poLoadError.message}`,
        }
      }
      for (const po of purchaseOrders ?? []) {
        const nextNote = applyOpsSupplierNoteToPurchaseOrder(po.note, supplierNotes)
        const current = blank(po.note)
        if (nextNote === current) continue
        const written = await setPurchaseOrderNote(gate.admin, String(po.id), nextNote)
        if (!written.ok) {
          revalidateOps(ids.dealId)
          return {
            ok: false,
            message: `Fulfilment plan saved, but the purchase order note could not be updated: ${written.message}`,
          }
        }
      }
    }
    revalidateOps(ids.dealId)
    return { ok: true, message: "Fulfilment plan saved." }
  } catch (error) {
    const message = errorMessage(error)
    return {
      ok: false,
      message: missingColumn(message) ? "Apply the latest operations SQL in Supabase first, then try again." : message,
    }
  }
}

export async function markNamesSentToSupplier(input: {
  orderId?: string | null
  dealId?: string | null
  sent: boolean
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const ids = bookingIds(input)
  if (!ids.ok) return { ok: false, message: ids.error }
  const current = await currentOps(gate.admin, ids.orderId, ids.dealId)
  const method = parseSupplierFulfilmentMethod(current?.supplier_fulfilment_method)
  if (input.sent && method && !supplierNeedsNamesSent(method) && method !== "digital_to_zk" && method !== "collect_from_supplier") {
    // still allow marking names sent for any method
  }
  try {
    await writeOpsPatch(gate.admin, gate.profile.id, ids.orderId, ids.dealId, {
      supplier_details_sent_at: input.sent ? new Date().toISOString() : null,
      ...(input.sent && method && supplierNeedsNamesSent(method)
        ? { supplier_status: method === "names_only" ? "not_required" : current?.supplier_status ?? "confirmed" }
        : {}),
    })
    revalidateOps(ids.dealId)
    return { ok: true, message: input.sent ? "Marked names sent to the supplier." : "Cleared names-sent." }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function stampTicketsReceived(input: {
  orderId?: string | null
  dealId?: string | null
  purchaseOrderIds: string[]
  received: boolean
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const ids = bookingIds(input)
  if (!ids.ok) return { ok: false, message: ids.error }
  const poIds = [...new Set(input.purchaseOrderIds.filter((id) => UUID_RE.test(id)))]
  const date = input.received ? todayIso() : null
  try {
    for (const poId of poIds) {
      const result = await setPurchaseOrderOpsDates(gate.admin, poId, { ticketsReceivedAt: date })
      if (!result.ok) return result
    }
    const current = await currentOps(gate.admin, ids.orderId, ids.dealId)
    const method = parseSupplierFulfilmentMethod(current?.supplier_fulfilment_method)
    await writeOpsPatch(gate.admin, gate.profile.id, ids.orderId, ids.dealId, {
      supplier_status: input.received
        ? "tickets_received"
        : method && supplierNeedsTicketsIn(method)
          ? "pending"
          : current?.supplier_status ?? "confirmed",
    })
    revalidateOps(ids.dealId)
    revalidatePath("/admin/purchase-orders")
    revalidatePath("/admin/catalog", "layout")
    return {
      ok: true,
      message: input.received ? "Tickets marked received." : "Tickets received date cleared.",
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export async function skipOperationsThankYou(input: {
  orderId?: string | null
  dealId?: string | null
  skip: boolean
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const ids = bookingIds(input)
  if (!ids.ok) return { ok: false, message: ids.error }
  try {
    await writeOpsPatch(gate.admin, gate.profile.id, ids.orderId, ids.dealId, {
      thank_you_skipped_at: input.skip ? new Date().toISOString() : null,
    })
    revalidateOps(ids.dealId)
    return { ok: true, message: input.skip ? "Thank-you skipped for this booking." : "Thank-you restored." }
  } catch (error) {
    const message = errorMessage(error)
    return {
      ok: false,
      message: missingColumn(message) ? "Apply the latest operations SQL in Supabase first, then try again." : message,
    }
  }
}

export async function addOperationsDeliveryProof(formData: FormData): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  const ids = bookingIds({
    orderId: String(formData.get("orderId") ?? ""),
    dealId: String(formData.get("dealId") ?? ""),
  })
  if (!ids.ok) return { ok: false, message: ids.error }

  const note = blank(String(formData.get("note") ?? ""))
  const rawFile = formData.get("file")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (!note && !file) return { ok: false, message: "Add a delivery note or upload a photo/screenshot." }
  if (file) {
    if (file.size > DELIVERY_PROOF_MAX_BYTES) return { ok: false, message: "Proof file must be 10MB or smaller." }
    if (!DELIVERY_PROOF_ALLOWED_TYPES.has(file.type)) {
      return { ok: false, message: "Proof file must be a JPG, PNG, WebP, or PDF." }
    }
  }

  let filePath: string | null = null
  let fileName: string | null = null
  let fileType: string | null = null
  let fileSize: number | null = null
  try {
    if (file) {
      fileName = cleanProofFileName(file.name)
      fileType = file.type
      fileSize = file.size
      filePath = `${ids.orderId || ids.dealId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`
      const { error: uploadError } = await gate.admin.storage
        .from(DELIVERY_PROOF_BUCKET)
        .upload(filePath, await file.arrayBuffer(), { contentType: file.type, upsert: false })
      if (uploadError) throw new Error(uploadError.message)
    }
    const invoiceId = await invoiceIdForOrder(gate.admin, ids.orderId)
    const { error } = await gate.admin.from("order_delivery_proofs").insert({
      order_id: ids.orderId,
      deal_id: ids.dealId,
      invoice_id: invoiceId,
      note,
      file_bucket: DELIVERY_PROOF_BUCKET,
      file_path: filePath,
      file_name: fileName,
      file_content_type: fileType,
      file_size: fileSize,
      created_by: gate.profile.id,
    })
    if (error) throw new Error(error.message)

    const current = await currentOps(gate.admin, ids.orderId, ids.dealId)
    await writeOpsPatch(gate.admin, gate.profile.id, ids.orderId, ids.dealId, {
      delivery_status: "delivered",
      fulfilment_status: "delivered",
    })
    if (ids.orderId) {
      await gate.admin
        .from("invoices")
        .update({ status: "delivered" })
        .eq("order_id", ids.orderId)
        .in("status", ["paid", "delivered"])
    }
    await syncDealWorkflowFromOperations(gate.admin, {
      actorProfileId: gate.profile.id,
      orderId: ids.orderId,
      dealId: ids.dealId,
      guestDetailsStatus: String(current?.guest_details_status ?? "complete"),
      deliveryStatus: "delivered",
      fulfilmentStatus: "delivered",
    })
    revalidateOps(ids.dealId)
    return { ok: true, message: "Booking marked fulfilled with proof of delivery." }
  } catch (error) {
    if (filePath) await gate.admin.storage.from(DELIVERY_PROOF_BUCKET).remove([filePath])
    const message = errorMessage(error)
    return {
      ok: false,
      message: missingColumn(message) ? "Apply the latest operations SQL in Supabase first, then try again." : message,
    }
  }
}

export async function requireDeliveryProofBeforeDeliver(
  orderId: string | null,
  dealId: string | null,
): Promise<Result | null> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is required." }
  if (await hasDeliveryProof(admin, orderId, dealId)) return null
  return { ok: false, message: "Add a photo, screenshot, or note as proof of delivery before marking fulfilled." }
}
