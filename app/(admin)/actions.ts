"use server"

import { revalidatePath } from "next/cache"
import { revalidateAdminProfitPaths } from "@/lib/admin/revalidate-profit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { sanitizeHttpsUrl, sanitizeHttpsUrlList } from "@/lib/auth/safe-url"
import { normalizeCatalogImageUrl, normalizeCatalogImageUrlList } from "@/lib/images/display-image-url"
import { deriveInventoryGroupId, isMultiDayComboDuration } from "@/lib/catalog/inventory-group"
import { ensureShellSingleTicketsForParent } from "@/lib/catalog/ensure-shell-single-tickets"
import { generatePackageIdFromRaceAndName } from "@/lib/catalog/generate-package-id"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"
import { inferPackageDurationFromName, isValidPackageDuration } from "@/lib/catalog/package-duration"
import { sendBookingApprovalRejectedEmail } from "@/lib/email/send-booking-approval-rejected"
import { executeBookingApproval } from "@/lib/booking-approval/execute-approval"
import { mapPlaceOrderError } from "@/lib/orders/place-order-errors"
import { getPortalProfile } from "@/lib/supabase/profile"
import { isInvoiceWorkflowStatus, normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { enqueuePackageInventoryChannelSync, enqueueProductUpsert } from "@/lib/integrations/enqueue"
import { repairLinkedGroupInventory } from "@/lib/inventory/repair-linked-group"
import { enqueueOpportunityOutcomeServer, enqueueOrderIntegrationsServer } from "@/lib/integrations/enqueue-server"
import { drainOutboxNow } from "@/lib/integrations/schedule-drain"
import { processIntegrationOutbox } from "@/lib/integrations/process-outbox"
import { pullInventoryFromSalesforce } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"
import { syncPackageToSalesforce } from "@/lib/integrations/salesforce/products"
import { isSalesforceConfigured } from "@/lib/integrations/salesforce/config"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { syncPackageCatalogToWix } from "@/lib/integrations/wix/catalog-sync"
import { createWixProductForPackage as createWixProductForPackageApi } from "@/lib/integrations/wix/create-product"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { deleteWixProductsForPackage } from "@/lib/integrations/wix/delete-product"
import { deleteSalesforceProductForPackage } from "@/lib/integrations/salesforce/delete-product"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"

type ActionResult = { ok: true; message?: string } | { ok: false; message: string }

export type PackageIntegrationSnapshot = {
  integration_sync_status: string
  integration_sync_error: string | null
  integration_synced_at: string | null
  product_code: string | null
  salesforce_product_id: string | null
}

type PackageSyncActionResult =
  | ({ ok: true; message?: string; integration?: PackageIntegrationSnapshot })
  | ({ ok: false; message: string; integration?: PackageIntegrationSnapshot })

/** Coalesce overlapping admin "Queue Salesforce sync" clicks on the same package. */
const packageSyncInFlight = new Map<string, Promise<unknown>>()

type UrlActionResult = { ok: true; url: string } | { ok: false; message: string }
type WixListingSaveResult =
  | { ok: true; message?: string; listing?: WixChannelListingRow }
  | { ok: false; message: string }

const PRODUCT_CODE_RE = /^[^\s].{0,63}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DELIVERY_PROOF_BUCKET = "order-delivery-proofs"
const DELIVERY_PROOF_MAX_BYTES = 10 * 1024 * 1024
const DELIVERY_PROOF_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"])
const PO_DOCUMENT_BUCKET = "purchase-order-documents"
const PO_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
const PO_DOCUMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

function normalizeProductCode(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? ""
  return t.length > 0 ? t : null
}

async function validateUniqueProductCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productCode: string | null,
  excludePackageId?: string,
): Promise<string | null> {
  if (!productCode) return null
  if (!PRODUCT_CODE_RE.test(productCode)) {
    return "Product code must be 1–64 characters with no leading/trailing spaces."
  }
  let q = supabase.from("packages").select("id").eq("product_code", productCode)
  if (excludePackageId) q = q.neq("id", excludePackageId)
  const { data, error } = await q.maybeSingle()
  if (error) return error.message
  if (data) return "Another package already uses this Product Code."
  return null
}

async function getInventorySyncPackageIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
): Promise<string[]> {
  const id = packageId.trim()
  if (!id) return []

  const { data: pkg } = await supabase
    .from("packages")
    .select("id, inventory_group_id")
    .eq("id", id)
    .maybeSingle()

  const groupId = typeof pkg?.inventory_group_id === "string" ? pkg.inventory_group_id.trim() : ""
  if (!groupId) return [id]

  const { data: linked } = await supabase
    .from("packages")
    .select("id")
    .eq("inventory_group_id", groupId)

  const ids = (linked ?? [])
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean)

  return ids.length > 0 ? ids : [id]
}

async function enqueueLinkedInventoryChannelSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
): Promise<void> {
  const ids = await getInventorySyncPackageIds(supabase, packageId)
  for (const id of ids) {
    await enqueuePackageInventoryChannelSync(supabase, id)
  }
}

/** After cost-layer add/remove/resize, recompute linked pool from layers and push Stock to SF. */
async function reconcileInventoryAfterCostLayerChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
): Promise<void> {
  const id = packageId.trim()
  if (!id) return

  const { data: pkgMeta } = await supabase
    .from("packages")
    .select("inventory_group_id")
    .eq("id", id)
    .maybeSingle()
  const groupId = (pkgMeta as { inventory_group_id?: string | null } | null)?.inventory_group_id?.trim()

  if (groupId) {
    // Heal pushes SF Stock/Available for the whole group and Wix inventory — do not also
    // enqueue product.upsert for every sibling/shell (that burned Salesforce TotalRequests).
    const { healLinkedGroupInBackground } = await import("@/lib/inventory/linked-group-inventory")
    await healLinkedGroupInBackground(groupId).catch((e) => {
      console.warn(
        "[admin] heal after cost-layer change failed:",
        e instanceof Error ? e.message : e,
      )
    })
    return
  }

  try {
    const { syncPackageToSalesforce } = await import("@/lib/integrations/salesforce/products")
    await syncPackageToSalesforce(id)
  } catch (e) {
    console.warn(
      "[admin] Salesforce sync after cost-layer change failed:",
      e instanceof Error ? e.message : e,
    )
  }
  try {
    const { syncPackageCatalogToWix } = await import("@/lib/integrations/wix/catalog-sync")
    await syncPackageCatalogToWix(id)
  } catch (e) {
    console.warn(
      "[admin] Wix sync after cost-layer change failed:",
      e instanceof Error ? e.message : e,
    )
  }
}

export async function requireAdminAction(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; profile: NonNullable<Awaited<ReturnType<typeof getPortalProfile>>> }
  | { ok: false; message: string }
> {
  const profile = await getPortalProfile()
  if (!profile) return { ok: false, message: "Not signed in." }
  if (profile.role !== "admin") return { ok: false, message: "Admin access required." }
  const supabase = await createClient()
  return { ok: true, supabase, profile }
}

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
    .select("status, issued_at, order_id")
    .eq("id", id)
    .maybeSingle()
  if (fetchError) return { ok: false, message: fetchError.message }
  if (!current) return { ok: false, message: "Invoice not found." }

  if (status === "delivered") {
    const { data: proof, error: proofError } = await supabase
      .from("order_delivery_proofs")
      .select("id")
      .eq("invoice_id", id)
      .limit(1)
      .maybeSingle()
    if (proofError) return { ok: false, message: proofError.message }
    if (!proof) {
      return { ok: false, message: "Add proof of delivery or an internal delivery note before marking as delivered." }
    }
  }

  const previousStatus = normalizeInvoiceStatus(current.status)
  const patch: { status: InvoiceWorkflowStatus; issued_at?: string | null } = { status }

  if (
    (status === "awaiting_payment" || status === "paid" || status === "delivered") &&
    (previousStatus === "awaiting_invoice" || current.issued_at == null)
  ) {
    patch.issued_at = new Date().toISOString()
  }
  if (status === "awaiting_invoice") {
    patch.issued_at = null
  }

  const { error } = await supabase.from("invoices").update(patch).eq("id", id)
  if (error) return { ok: false, message: error.message }

  const orderId = current.order_id
  if (orderId && status === "paid") {
    const enq = await enqueueOpportunityOutcomeServer(String(orderId), "won")
    if (!enq.ok) {
      revalidatePath("/admin/agents")
      revalidatePath("/admin/orders")
      revalidatePath("/bookings")
      return {
        ok: true,
        message: `Invoice marked paid. Salesforce Closed Won was not queued (${enq.message}). Process sync queue or check Integrations.`,
      }
    }
  }

  revalidatePath("/admin/agents")
  revalidatePath("/admin/orders")
  revalidatePath("/bookings")
  revalidatePath("/admin/integrations/salesforce")
  return { ok: true }
}

function cleanDeliveryProofFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120)
  return cleaned || "delivery-proof"
}

export async function addDeliveryProofAndMarkDelivered(formData: FormData): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const invoiceId = String(formData.get("invoiceId") ?? "").trim()
  if (!UUID_RE.test(invoiceId)) return { ok: false, message: "Invalid invoice id." }

  const note = String(formData.get("note") ?? "").trim().slice(0, 2000)
  const rawFile = formData.get("file")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (!note && !file) {
    return { ok: false, message: "Add a delivery note or upload proof before marking as delivered." }
  }
  if (file) {
    if (file.size > DELIVERY_PROOF_MAX_BYTES) {
      return { ok: false, message: "Proof file must be 10MB or smaller." }
    }
    if (!DELIVERY_PROOF_ALLOWED_TYPES.has(file.type)) {
      return { ok: false, message: "Proof file must be a JPG, PNG, WebP, or PDF." }
    }
  }

  const { data: invoice, error: invoiceError } = await gate.supabase
    .from("invoices")
    .select("order_id")
    .eq("id", invoiceId)
    .maybeSingle()
  if (invoiceError) return { ok: false, message: invoiceError.message }
  const orderId = String(invoice?.order_id ?? "").trim()
  if (!UUID_RE.test(orderId)) return { ok: false, message: "Invoice order was not found." }

  let filePath: string | null = null
  let fileName: string | null = null
  let fileType: string | null = null
  let fileSize: number | null = null

  if (file) {
    const admin = createAdminClient()
    if (!admin) {
      return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to upload delivery proof files." }
    }
    fileName = cleanDeliveryProofFileName(file.name)
    fileType = file.type
    fileSize = file.size
    filePath = `${orderId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`

    const { error: uploadError } = await admin.storage
      .from(DELIVERY_PROOF_BUCKET)
      .upload(filePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      })
    if (uploadError) return { ok: false, message: uploadError.message }
  }

  const { error: insertError } = await gate.supabase.from("order_delivery_proofs").insert({
    order_id: orderId,
    invoice_id: invoiceId,
    note: note || null,
    file_bucket: DELIVERY_PROOF_BUCKET,
    file_path: filePath,
    file_name: fileName,
    file_content_type: fileType,
    file_size: fileSize,
    created_by: gate.profile.id,
  })
  if (insertError) {
    if (filePath) {
      const admin = createAdminClient()
      await admin?.storage.from(DELIVERY_PROOF_BUCKET).remove([filePath])
    }
    return { ok: false, message: insertError.message }
  }

  return updateInvoiceStatus(invoiceId, "delivered")
}

export async function getDeliveryProofDownloadUrl(proofId: string): Promise<UrlActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const id = proofId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid proof id." }

  const { data: proof, error } = await gate.supabase
    .from("order_delivery_proofs")
    .select("file_bucket, file_path, file_name")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  const bucket = String(proof?.file_bucket ?? DELIVERY_PROOF_BUCKET)
  const path = String(proof?.file_path ?? "").trim()
  if (!path) return { ok: false, message: "This delivery proof has no uploaded file." }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to open proof files." }

  const { data, error: signedError } = await admin.storage.from(bucket).createSignedUrl(path, 300, {
    download: proof?.file_name ?? true,
  })
  if (signedError || !data?.signedUrl) {
    return { ok: false, message: signedError?.message ?? "Could not create proof download link." }
  }
  return { ok: true, url: data.signedUrl }
}

export async function cancelAdminOrder(orderId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = orderId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid order id." }

  const { data: orderBefore } = await gate.supabase
    .from("orders")
    .select("id")
    .eq("id", id)
    .maybeSingle()

  const { data, error } = await gate.supabase.rpc("admin_cancel_order", { p_order_id: id })
  if (error) {
    const msg = error.message
    if (msg.includes("already_cancelled")) return { ok: false, message: "This order is already cancelled." }
    if (msg.includes("order_not_found")) return { ok: false, message: "Order not found." }
    return { ok: false, message: msg }
  }

  const row = data as { package_id?: string; order_reference?: string } | null
  if (orderBefore?.id) {
    await enqueueOpportunityOutcomeServer(String(orderBefore.id), "lost")
  }
  const packageId = row?.package_id?.trim()
  if (packageId) {
    await enqueuePackageInventoryChannelSync(gate.supabase, packageId)
  }

  revalidatePath("/admin/orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/bookings")
  revalidateAdminProfitPaths()

  const ref = row?.order_reference?.trim()
  return {
    ok: true,
    message: ref
      ? `${ref} cancelled. Stock restored; Salesforce Closed Lost queued (process sync queue).`
      : "Order cancelled. Stock restored; Salesforce Closed Lost queued.",
  }
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
  inventory_group_id?: string | null
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
  const image = normalizeCatalogImageUrl(sanitizeHttpsUrl(input.image))
  const gallery = normalizeCatalogImageUrlList(sanitizeHttpsUrlList(input.gallery_images))
  const desc = input.description.trim()
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  const { data: existing, error: exErr } = await supabase
    .from("packages")
    .select("race_id, inventory_group_id")
    .eq("id", id)
    .maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const raceId = input.race_id.trim()
  const manualInventoryGroupId = input.inventory_group_id?.trim() || null
  const inventoryGroupId = duration
    ? manualInventoryGroupId ?? deriveInventoryGroupId(id, duration, raceId)
    : null
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

  const previousInventoryGroupId =
    typeof existing.inventory_group_id === "string" ? existing.inventory_group_id.trim() || null : null

  if (previousInventoryGroupId && previousInventoryGroupId !== inventoryGroupId) {
    await supabase.rpc("reconcile_linked_multi_day_inventory", { p_group_id: previousInventoryGroupId })
    const { data: previousLinked } = await supabase
      .from("packages")
      .select("id")
      .eq("inventory_group_id", previousInventoryGroupId)
    for (const pkg of previousLinked ?? []) {
      const enq = await enqueueProductUpsert(supabase, String(pkg.id))
      if (!enq.ok) return { ok: false, message: enq.message }
    }
  }

  if (inventoryGroupId) {
    await supabase.rpc("reconcile_linked_multi_day_inventory", { p_group_id: inventoryGroupId })
    await enqueuePackageInventoryChannelSync(supabase, id)
  } else {
    const enq = await enqueueProductUpsert(supabase, id)
    if (!enq.ok) return { ok: false, message: enq.message }
  }

  revalidatePackagePaths((existing as { race_id: string }).race_id, input.race_id.trim())
  return { ok: true }
}

export async function updatePackageIntegration(input: {
  packageId: string
  product_code: string | null
  salesforce_product_id: string | null
  retail_price_multiplier: number | null
  wix_retail_price?: number | null
  sell_on_trade_portal: boolean
  sell_on_wix: boolean
  sell_on_partners: boolean
  enqueue_sync?: boolean
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = input.packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const productCode = normalizeProductCode(input.product_code)
  const codeErr = await validateUniqueProductCode(supabase, productCode, id)
  if (codeErr) return { ok: false, message: codeErr }

  let mult = input.retail_price_multiplier
  if (mult != null && (!Number.isFinite(mult) || mult <= 0)) {
    return { ok: false, message: "Retail price multiplier must be a positive number." }
  }
  const wixRetailPrice = input.wix_retail_price ?? null
  if (wixRetailPrice != null && (!Number.isFinite(wixRetailPrice) || wixRetailPrice < 0)) {
    return { ok: false, message: "Manual Wix price must be zero or a positive number." }
  }

  const { data: existing, error: exErr } = await supabase
    .from("packages")
    .select("race_id, product_code, salesforce_product_id")
    .eq("id", id)
    .maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const existingProductCode =
    typeof existing.product_code === "string" ? existing.product_code.trim() || null : null
  const existingProductId =
    typeof existing.salesforce_product_id === "string" ? existing.salesforce_product_id.trim() || null : null
  const nextProductId = input.salesforce_product_id?.trim() || null
  const identityChanged = existingProductCode !== productCode || existingProductId !== nextProductId

  const { error } = await supabase
    .from("packages")
    .update({
      product_code: productCode,
      salesforce_product_id: input.salesforce_product_id?.trim() || null,
      retail_price_multiplier: mult,
      wix_retail_price: wixRetailPrice,
      sell_on_trade_portal: input.sell_on_trade_portal,
      sell_on_wix: input.sell_on_wix,
      sell_on_partners: input.sell_on_partners,
      ...(identityChanged
        ? {
            integration_sync_status: input.enqueue_sync === false ? "idle" : "pending",
            integration_sync_error: null,
          }
        : {}),
    })
    .eq("id", id)

  if (error) return { ok: false, message: error.message }

  if (input.enqueue_sync !== false) {
    const enq = await enqueueProductUpsert(supabase, id)
    if (!enq.ok) return { ok: false, message: enq.message }
  }

  revalidatePackagePaths((existing as { race_id: string }).race_id)
  return { ok: true }
}

export async function clearPackageSalesforceLink(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const { data: existing, error: exErr } = await supabase
    .from("packages")
    .select("race_id")
    .eq("id", id)
    .maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const { error } = await supabase
    .from("packages")
    .update({
      product_code: null,
      salesforce_product_id: null,
      integration_sync_status: "idle",
      integration_synced_at: null,
      integration_sync_error: null,
    })
    .eq("id", id)
  if (error) return { ok: false, message: error.message }

  revalidatePackagePaths((existing as { race_id: string }).race_id)
  return { ok: true }
}

async function readPackageIntegrationSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
): Promise<PackageIntegrationSnapshot | null> {
  const { data: pkg, error } = await supabase
    .from("packages")
    .select(
      "integration_sync_status, integration_sync_error, integration_synced_at, product_code, salesforce_product_id, inventory_group_id, duration, shell_parent_package_id",
    )
    .eq("id", packageId)
    .maybeSingle()
  if (error || !pkg) return null

  const row = pkg as {
    integration_sync_status?: string
    integration_sync_error?: string | null
    integration_synced_at?: string | null
    product_code?: string | null
    salesforce_product_id?: string | null
  }

  return {
    integration_sync_status: row.integration_sync_status ?? "idle",
    integration_sync_error: row.integration_sync_error ?? null,
    integration_synced_at: row.integration_synced_at ?? null,
    product_code: row.product_code?.trim() || null,
    salesforce_product_id: row.salesforce_product_id?.trim() || null,
  }
}

/** Run Salesforce product sync inline (no outbox wait) and return the final status for the UI. */
export async function retryPackageIntegrationSync(packageId: string): Promise<PackageSyncActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  if (!isSalesforceConfigured()) {
    return {
      ok: false,
      message: "Salesforce is not configured. Check env vars, then try again.",
    }
  }
  const sf = await getSalesforceConnectionStatus()
  if (!sf.connected) {
    return {
      ok: false,
      message:
        "Salesforce is not connected. Open Admin → Integrations → Salesforce → Connect, then try again.",
    }
  }

  // Prevent double-click / overlapping syncs from burning Salesforce TotalRequests.
  const inflight = packageSyncInFlight.get(id)
  if (inflight) {
    try {
      await inflight
      const integration = await readPackageIntegrationSnapshot(gate.supabase, id)
      return {
        ok: true,
        message: "Salesforce sync was already in progress — waited for it to finish.",
        integration: integration ?? undefined,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const integration = await readPackageIntegrationSnapshot(gate.supabase, id)
      return { ok: false, message, integration: integration ?? undefined }
    }
  }

  const { error: pendingErr } = await gate.supabase
    .from("packages")
    .update({ integration_sync_status: "pending", integration_sync_error: null })
    .eq("id", id)
  if (pendingErr) return { ok: false, message: pendingErr.message }

  const syncPromise = syncPackageToSalesforce(id)
  packageSyncInFlight.set(id, syncPromise)
  try {
    await syncPromise
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const friendly =
      /TotalRequests|REQUEST_LIMIT_EXCEEDED/i.test(message)
        ? "Salesforce API daily request limit exceeded. Wait for the limit to reset (usually within a few hours), then sync once — do not keep retrying."
        : message
    await gate.supabase
      .from("packages")
      .update({
        integration_sync_status: "failed",
        integration_sync_error: friendly.slice(0, 500),
      })
      .eq("id", id)

    const integration = await readPackageIntegrationSnapshot(gate.supabase, id)
    revalidatePath("/admin/catalog")
    revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
    revalidatePath("/admin/integrations/salesforce")
    return { ok: false, message: friendly, integration: integration ?? undefined }
  } finally {
    packageSyncInFlight.delete(id)
  }

  // Drop any queued outbox jobs for this package so a later drain does not re-run the same sync.
  const admin = createAdminClient()
  if (admin) {
    await admin
      .from("integration_outbox")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
        last_error: "Completed via admin direct sync.",
      })
      .in("status", ["pending", "processing"])
      .filter("payload->>package_id", "eq", id)
      .in("event_type", ["product.upsert", "inventory.snapshot"])
  }

  // syncPackageToSalesforce already heals linked-group Stock/Available. Do not call
  // repairLinkedGroupInventory again — that duplicated SF API work and re-enqueued syncs.

  const integration = await readPackageIntegrationSnapshot(gate.supabase, id)
  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
  revalidatePath("/admin/integrations/salesforce")

  return {
    ok: true,
    message: "Synced to Salesforce successfully.",
    integration: integration ?? undefined,
  }
}

export async function createWixProductForPackage(packageId: string): Promise<WixListingSaveResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  try {
    const created = await createWixProductForPackageApi(id)
    const { supabase } = gate
    const { data: listing } = await supabase
      .from("channel_listings")
      .select(
        "id, package_id, external_id, external_variant_id, page_url, metadata, last_synced_at, last_sync_error",
      )
      .eq("package_id", id)
      .eq("channel", "wix")
      .maybeSingle()

    const enq = await enqueueProductUpsert(supabase, id)
    if (!enq.ok) return { ok: false, message: enq.message }

    revalidatePath("/admin/catalog")
    revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
    revalidatePath("/admin/integrations/wix")

    return {
      ok: true,
      message: `Wix product created (${created.productId}). Listing synced.`,
      listing: (listing as WixChannelListingRow | null) ?? undefined,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function saveWixChannelListing(input: {
  packageId: string
  external_id: string
  external_variant_id: string | null
  page_url: string | null
  inventory_item_id?: string | null
}): Promise<WixListingSaveResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const packageId = input.packageId.trim()
  const externalId = input.external_id.trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }
  if (!externalId) return { ok: false, message: "Wix Product ID is required." }

  const pageUrl = input.page_url ? sanitizeHttpsUrl(input.page_url) : null
  if (input.page_url?.trim() && !pageUrl) {
    return { ok: false, message: "Page URL must be https." }
  }

  const metadata: Record<string, unknown> = {}
  const invId = input.inventory_item_id?.trim()
  if (invId) metadata.inventory_item_id = invId

  const variantId = input.external_variant_id?.trim() || null

  const { data: existing } = await supabase
    .from("channel_listings")
    .select("id")
    .eq("package_id", packageId)
    .eq("channel", "wix")
    .eq("external_id", externalId)
    .maybeSingle()

  const listingColumns =
    "id, package_id, external_id, external_variant_id, page_url, metadata, last_synced_at, last_sync_error"

  let savedListing: Record<string, unknown> | null = null

  if (existing?.id) {
    const { data, error } = await supabase
      .from("channel_listings")
      .update({
        external_variant_id: variantId,
        page_url: pageUrl,
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(listingColumns)
      .single()
    if (error) return { ok: false, message: error.message }
    savedListing = data
  } else {
    const { data, error } = await supabase
      .from("channel_listings")
      .insert({
        package_id: packageId,
        channel: "wix",
        external_id: externalId,
        external_variant_id: variantId,
        page_url: pageUrl,
        metadata,
      })
      .select(listingColumns)
      .single()
    if (error) return { ok: false, message: error.message }
    savedListing = data
  }

  const wixSync = await syncPackageCatalogToWix(packageId)

  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  revalidatePath("/admin/integrations/wix")
  const syncMessage =
    wixSync.errors.length > 0
      ? `Wix mapping saved, but Wix sync failed: ${wixSync.errors.join(" · ")}`
      : wixSync.updated > 0
        ? `Wix mapping saved. Wix updated (${wixSync.updated} listing${wixSync.updated === 1 ? "" : "s"}).`
        : `Wix mapping saved. ${wixSync.skipped.join(" ")}`

  return {
    ok: wixSync.errors.length === 0,
    message: syncMessage,
    listing: (savedListing as WixChannelListingRow | null) ?? undefined,
  }
}

export async function deleteWixChannelListing(listingId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = listingId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid listing id." }

  const { data: row } = await gate.supabase
    .from("channel_listings")
    .select("package_id")
    .eq("id", id)
    .maybeSingle()

  const { error } = await gate.supabase.from("channel_listings").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }

  if (row?.package_id) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(String(row.package_id))}`)
  }
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/integrations/wix")
  return { ok: true }
}

export async function syncWixPackageNow(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const result = await syncPackageCatalogToWix(id)
  if (result.skipped.length && result.updated === 0 && result.errors.length === 0) {
    return { ok: false, message: result.skipped.join(" ") }
  }
  if (result.errors.length) {
    return { ok: false, message: result.errors.join(" · ") }
  }

  revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
  revalidatePath("/admin/integrations/wix")
  return {
    ok: true,
    message: `Wix updated (${result.updated} listing${result.updated === 1 ? "" : "s"}).`,
  }
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
  id?: string
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
  inventory_group_id?: string | null
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  is_hidden?: boolean
  requires_booking_approval?: boolean
  sort_order: number
  brochure_url: string | null
  product_code?: string | null
  /**
   * Optional pre-existing Salesforce Product2 Id (18-char, starts with 01t).
   * When set, the first sync will PATCH this Product2 in place instead of creating a new one.
   * The Product2's Name, Family, Description and inventory fields will be overwritten to match
   * the portal package. Only use this to reuse a Product2 that this portal package "owns".
   */
  salesforce_product_id?: string | null
  sell_on_wix?: boolean
  /** Per-package Wix markup over trade (e.g. 1.1). Null = env default. */
  retail_price_multiplier?: number | null
  /** Absolute Wix unit price; overrides multiplier when set. */
  wix_retail_price?: number | null
  initial_qty_available: number
  initial_unit_cost: number | null
  initial_cost_note: string | null
  initial_source?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const raceId = input.race_id.trim()
  const { data: race, error: rErr } = await supabase.from("races").select("id").eq("id", raceId).maybeSingle()
  if (rErr) return { ok: false, message: rErr.message }
  if (!race) return { ok: false, message: "Race not found." }

  const manualId = input.id?.trim().toLowerCase().replace(/\s+/g, "-") ?? ""
  let id = manualId || generatePackageIdFromRaceAndName(raceId, input.name.trim())
  if (!/^[a-z0-9][a-z0-9-]{1,126}$/.test(id)) {
    return { ok: false, message: "Could not generate a valid package id from the name. Try a different display name." }
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? id : `${id.slice(0, 118)}-${attempt}`
    const { data: dup } = await supabase.from("packages").select("id").eq("id", candidate).maybeSingle()
    if (!dup) {
      id = candidate
      break
    }
    if (attempt === 49) {
      return { ok: false, message: "A package with this name already exists for this race. Use a different display name." }
    }
  }

  const durationInput = (input.duration ?? "").trim()
  const duration = durationInput || inferPackageDurationFromName(input.name.trim()) || ""
  if (!duration) {
    return { ok: false, message: "Duration is required. Choose 3 day, 2 day, or a single-day option." }
  }
  if (!isValidPackageDuration(duration)) {
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
  const image = normalizeCatalogImageUrl(sanitizeHttpsUrl(input.image))
  const gallery = normalizeCatalogImageUrlList(sanitizeHttpsUrlList(input.gallery_images))
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  let retailMultiplier: number | null = input.retail_price_multiplier ?? null
  if (retailMultiplier != null && (!Number.isFinite(retailMultiplier) || retailMultiplier <= 0)) {
    return { ok: false, message: "Wix price multiplier must be a positive number (e.g. 1.1)." }
  }
  let wixRetailPrice: number | null = input.wix_retail_price ?? null
  if (wixRetailPrice != null && (!Number.isFinite(wixRetailPrice) || wixRetailPrice < 0)) {
    return { ok: false, message: "Manual Wix price must be zero or a positive number." }
  }

  const sellOnWix = input.sell_on_wix === true && !input.is_enquiry
  if (sellOnWix) {
    const { retailPriceFromTrade } = await import("@/lib/integrations/retail-price")
    const retail = retailPriceFromTrade(input.trade_price, retailMultiplier, wixRetailPrice)
    if (retail == null) {
      return {
        ok: false,
        message:
          "Sell on Wix requires a trade price and/or a manual Wix price so the website product can be created.",
      }
    }
  }

  const manualInventoryGroupId = input.inventory_group_id?.trim() || null
  const inventoryGroupId = duration
    ? manualInventoryGroupId ?? deriveInventoryGroupId(id, duration || null, raceId)
    : null
  const requiresBookingApproval =
    input.requires_booking_approval ?? isPaddockClubPackageName(input.name.trim())

  const productCode = normalizeProductCode(input.product_code)
  const codeErr = await validateUniqueProductCode(supabase, productCode)
  if (codeErr) return { ok: false, message: codeErr }

  const salesforceProductIdRaw = input.salesforce_product_id?.trim() ?? ""
  const salesforceProductId = salesforceProductIdRaw.length === 0 ? null : salesforceProductIdRaw
  if (salesforceProductId != null && !/^[a-zA-Z0-9]{15,18}$/.test(salesforceProductId)) {
    return {
      ok: false,
      message: `Salesforce Product Id must be 15–18 alphanumeric characters (got "${salesforceProductId}").`,
    }
  }

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
    product_code: productCode,
    salesforce_product_id: salesforceProductId,
    sell_on_trade_portal: true,
    sell_on_wix: sellOnWix,
    sell_on_partners: false,
    retail_price_multiplier: retailMultiplier,
    wix_retail_price: wixRetailPrice,
    integration_sync_status: "pending",
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
    const siblingRows = (siblings ?? []) as Array<{ id: string; duration: string | null }>
    if (siblingRows.length > 0) {
      const siblingIds = siblingRows.map((s) => s.id)
      const { data: invRows } = await supabase
        .from("package_inventory")
        .select("package_id, qty_available")
        .in("package_id", siblingIds)
      const invBy = new Map(
        (invRows ?? []).map((r) => [
          String((r as { package_id: string }).package_id),
          Number((r as { qty_available: number | null }).qty_available ?? 0),
        ]),
      )
      const DAY_DURATIONS = ["thursday_only", "friday_only", "saturday_only", "sunday_only"] as const
      const isDayDuration = (d: string | null | undefined) =>
        d != null && (DAY_DURATIONS as readonly string[]).includes(d)
      const dur = duration || ""
      let seedQty: number | null = null
      if (isDayDuration(dur)) {
        // Seed order:
        //   1) A same-duration peer already in the group (they represent the same day).
        //   2) Any other day sibling — with no day-only sales they all mirror the base pool.
        //   3) The multi-day combo (3-day / 2-day) — its qty is the min day capacity so it's
        //      the safest fallback that can't overstate any day's availability.
        // This intentionally covers friday_only and thursday_only too; leaving them at 0
        // would zero out the 3-day via reconcile_linked_multi_day_inventory(min).
        const peer = siblingRows.find((s) => s.duration === dur)
        if (peer) {
          seedQty = invBy.get(peer.id) ?? null
        } else {
          const anotherDay = siblingRows.find((s) => isDayDuration(s.duration))
          if (anotherDay) {
            seedQty = invBy.get(anotherDay.id) ?? null
          } else {
            const multiDay = siblingRows.find((s) => isMultiDayComboDuration(s.duration))
            if (multiDay) seedQty = invBy.get(multiDay.id) ?? null
          }
        }
      } else if (isMultiDayComboDuration(dur)) {
        const dayCaps = siblingRows
          .filter((s) => isDayDuration(s.duration))
          .map((s) => invBy.get(s.id))
          .filter((n): n is number => n != null)
        if (dayCaps.length > 0) seedQty = Math.min(...dayCaps)
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
      p_source: input.initial_source?.trim() || null,
    })
    if (layerErr) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return { ok: false, message: layerErr.message }
    }
  }

  // 3-day parents need three Single Ticket children in Salesforce so opportunity lines
  // break out each race day. We provision those children as hidden portal shells now; the
  // parent's own sync (below) is responsible for syncing them to Salesforce and linking them
  // as Package Item children — see `syncPackageToSalesforce` for the recursive step.
  // Use the service-role client so shell inserts always persist trade_price = 0 (and related
  // fields) even if the admin session client omits defaults under RLS.
  if (duration === "3_day") {
    try {
      const admin = createAdminClient()
      await ensureShellSingleTicketsForParent(admin ?? supabase, id)
    } catch (e) {
      console.warn(
        "[createPackage] Shell single tickets were not created:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  let wixNote: string | undefined
  const canAutoCreateWix = sellOnWix

  if (canAutoCreateWix) {
    if (!isWixConfigured()) {
      wixNote =
        "Wix website was enabled, but Wix API is not configured (WIX_API_KEY / WIX_SITE_ID) — create the Wix product from Integrations after env is set."
      console.warn(`[createPackage] ${wixNote}`)
    } else {
      try {
        const created = await createWixProductForPackageApi(id)
        wixNote = `Wix product created (${created.productName}).`
        revalidatePath("/admin/integrations/wix")
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        wixNote = `Package saved, but Wix product was not created: ${detail}`
        console.warn("[createPackage] Wix product was not created:", detail)
      }
    }
  }

  const DAY_DURATIONS_FOR_CREATE = ["thursday_only", "friday_only", "saturday_only", "sunday_only"] as const
  const isLinkedDayPackage =
    !!inventoryGroupId &&
    duration != null &&
    (DAY_DURATIONS_FOR_CREATE as readonly string[]).includes(duration)

  if (isLinkedDayPackage) {
    const enq = await enqueueProductUpsert(supabase, id)
    if (!enq.ok) console.warn(`[createPackage] Salesforce sync not queued for ${id}:`, enq.message)

    if (salesforceProductId) {
      const { data: threeDay } = await supabase
        .from("packages")
        .select("id")
        .eq("inventory_group_id", inventoryGroupId)
        .eq("duration", "3_day")
        .limit(1)
        .maybeSingle()
      if (threeDay?.id) {
        const repair = await repairLinkedGroupInventory(String(threeDay.id))
        if (!repair.ok) {
          console.warn("[createPackage] Linked group inventory sync from Salesforce:", repair.message)
        }
      }
    }
  } else if (duration === "3_day") {
    // Parent sync creates + syncs shell Single Tickets. Do not also enqueue each shell
    // here — parallel shell jobs raced the parent and surfaced a false "Sync failed" even
    // though the shells usually succeeded on the next outbox pass.
    const enq = await enqueueProductUpsert(supabase, id)
    if (!enq.ok) console.warn(`[createPackage] Salesforce sync not queued for ${id}:`, enq.message)
  } else {
    await enqueuePackageInventoryChannelSync(supabase, id)
  }

  revalidatePackagePaths(input.race_id.trim())
  revalidatePath("/admin")
  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)

  return {
    ok: true,
    message: wixNote ? `Package created. ${wixNote}` : "Package created.",
  }
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

  const { data: current } = await supabase
    .from("package_inventory")
    .select("qty_available")
    .eq("package_id", packageId)
    .maybeSingle()

  if (current && current.qty_available !== qty_available) {
    const { error } = await supabase
      .from("package_inventory")
      .update({ qty_available })
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
  }

  const { error: holdErr } = await supabase.rpc("admin_set_package_qty_held", {
    p_package_id: packageId,
    p_qty_held: qty_held,
  })
  if (holdErr) {
    const m = holdErr.message.toLowerCase()
    if (m.includes("held_exceeds_available")) {
      return {
        ok: false,
        message:
          "Held quantity cannot exceed available capacity on this package or a linked sibling.",
      }
    }
    return { ok: false, message: holdErr.message }
  }

  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  await enqueueLinkedInventoryChannelSync(supabase, packageId)
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
  await enqueueLinkedInventoryChannelSync(supabase, input.packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath("/admin/holds")
  return { ok: true }
}

export async function releaseInventoryHold(holdId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate
  const id = holdId.trim()
  const { data: hold } = await supabase
    .from("inventory_holds")
    .select("package_id")
    .eq("id", id)
    .maybeSingle()
  const { error } = await supabase.rpc("admin_release_hold", { p_hold_id: id })
  if (error) return { ok: false, message: error.message }
  if (hold?.package_id) {
    await enqueueLinkedInventoryChannelSync(supabase, String(hold.package_id))
  }
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath("/admin/holds")
  return { ok: true }
}

export async function updateOrderSupplierAllocations(input: {
  orderId: string
  packageId: string
  allocations: Array<{ costLayerId: string; quantity: number }>
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const orderId = input.orderId.trim()
  const packageId = input.packageId.trim()
  if (!UUID_RE.test(orderId)) return { ok: false, message: "Invalid order id." }
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const allocations = input.allocations.map((a) => ({
    cost_layer_id: a.costLayerId.trim(),
    quantity: Math.floor(Number(a.quantity)),
  }))

  if (allocations.length === 0) {
    return { ok: false, message: "Add at least one supplier allocation." }
  }
  for (const a of allocations) {
    if (!UUID_RE.test(a.cost_layer_id)) {
      return { ok: false, message: "Choose a supplier for every allocation row." }
    }
    if (!Number.isFinite(a.quantity) || a.quantity <= 0) {
      return { ok: false, message: "Allocation quantities must be positive whole numbers." }
    }
  }

  const { error } = await gate.supabase.rpc("admin_set_order_cost_allocations", {
    p_order_id: orderId,
    p_allocations: allocations,
  })
  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("allocation_total_must_equal_order_guests")) {
      return { ok: false, message: "Supplier quantities must add up to the order guest count." }
    }
    if (msg.includes("insufficient_layer_remaining")) {
      return {
        ok: false,
        message:
          "That supplier layer does not have enough remaining stock. Adjust the split or add stock first.",
      }
    }
    if (msg.includes("invalid_cost_layer_for_order_package")) {
      return { ok: false, message: "Selected supplier stock does not belong to this package." }
    }
    if (msg.includes("order_cancelled")) {
      return { ok: false, message: "Cancelled orders cannot be reallocated." }
    }
    return { ok: false, message: error.message }
  }

  revalidateAdminProfitPaths(packageId)
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  revalidatePath("/admin/orders")
  revalidatePath("/admin/agents")
  return { ok: true }
}

export async function runIntegrationOutboxNow(): Promise<
  { ok: true; result: Awaited<ReturnType<typeof processIntegrationOutbox>> } | { ok: false; message: string }
> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  try {
    const result = await processIntegrationOutbox()
    revalidatePath("/admin/integrations/salesforce")
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/orders")
    return { ok: true, result }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Outbox processing failed." }
  }
}

export async function clearSalesforceSyncFailures(): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  // Use service role — session client may lack permission to clear all rows, so "Clear"
  // looked like a no-op while the same errors kept showing.
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const { error: outboxErr } = await admin
    .from("integration_outbox")
    .delete()
    .eq("status", "failed")
  if (outboxErr) return { ok: false, message: outboxErr.message }

  // Drop pending retries that will only burn API (limit / Supplier lookup mismatches).
  const { data: pendingBad } = await admin
    .from("integration_outbox")
    .select("id, last_error")
    .eq("status", "pending")
    .not("last_error", "is", null)
    .limit(200)
  const badIds = (pendingBad ?? [])
    .filter((row) => {
      const err = String(row.last_error ?? "")
      return /TotalRequests|REQUEST_LIMIT_EXCEEDED|id value of incorrect type/i.test(err)
    })
    .map((row) => String(row.id))
  if (badIds.length > 0) {
    await admin.from("integration_outbox").delete().in("id", badIds)
  }

  const { error: packageErr } = await admin
    .from("packages")
    .update({
      integration_sync_status: "idle",
      integration_sync_error: null,
    })
    .not("integration_sync_error", "is", null)
  if (packageErr) return { ok: false, message: packageErr.message }

  // Do NOT re-queue failed orders as pending — that re-ran Supplier Lookup failures forever.
  // Clear the banner; keep Opportunity when present so the order stays linked.
  const { error: orderSyncedErr } = await admin
    .from("orders")
    .update({
      salesforce_sync_status: "synced",
      salesforce_line_item_status: "synced",
      salesforce_sync_error: null,
    })
    .or("salesforce_sync_status.eq.failed,salesforce_line_item_status.eq.failed")
    .not("salesforce_opportunity_id", "is", null)
  if (orderSyncedErr) return { ok: false, message: orderSyncedErr.message }

  const { error: orderErrClear } = await admin
    .from("orders")
    .update({ salesforce_sync_error: null })
    .or("salesforce_sync_status.eq.failed,salesforce_line_item_status.eq.failed")
    .is("salesforce_opportunity_id", null)
  if (orderErrClear) return { ok: false, message: orderErrClear.message }

  revalidatePath("/admin/integrations/salesforce")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/orders")
  return { ok: true }
}

/** Pull offline Salesforce sales into portal inventory (light — no org-wide Available scan). */
export async function pullSalesforceInventoryNow(): Promise<
  | {
      ok: true
      pull: Awaited<ReturnType<typeof pullInventoryFromSalesforce>>
      outbox: Awaited<ReturnType<typeof drainOutboxNow>> | null
    }
  | { ok: false; message: string }
> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  try {
    const { pullInventoryFromSalesforce } = await import(
      "@/lib/integrations/salesforce/pull-inventory-from-salesforce"
    )
    // offlineSalesOnly: Closed Won + heal affected packages only. Full force pulls were
    // burning TotalRequests and failing before offline sales could land.
    const pull = await pullInventoryFromSalesforce({ force: true, offlineSalesOnly: true })
    if (pull.skipped) {
      return { ok: false, message: pull.message ?? "Salesforce inventory pull was skipped." }
    }
    revalidatePath("/admin/integrations/salesforce")
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/inventory")
    return { ok: true, pull, outbox: null }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Salesforce inventory pull failed." }
  }
}

/**
 * Import Salesforce Stock Sources into portal purchase lines for one package.
 * Ledger-only: does not increase sellable / available inventory.
 */
export async function importPackageStockSourcesFromSalesforce(
  packageId: string,
): Promise<ActionResult & { imported?: number }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const { supabase } = gate
  const { data: pkg, error } = await supabase
    .from("packages")
    .select("id, salesforce_product_id, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!pkg) return { ok: false, message: "Package not found." }
  if (pkg.shell_parent_package_id) {
    return { ok: false, message: "Shell single tickets do not own stock sources." }
  }
  const product2Id = typeof pkg.salesforce_product_id === "string" ? pkg.salesforce_product_id.trim() : ""
  if (!product2Id) {
    return { ok: false, message: "Link a Salesforce product first." }
  }

  try {
    const { importStockSourcesFromSalesforce } = await import(
      "@/lib/integrations/salesforce/stock-sources"
    )
    const admin = createAdminClient()
    if (!admin) return { ok: false, message: "Service role is not configured." }
    const result = await importStockSourcesFromSalesforce({
      admin,
      packageId: id,
      product2Id,
    })
    revalidateAdminProfitPaths(id)
    revalidatePath("/admin/inventory")
    revalidatePath("/admin/catalog")
    revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
    if (result.errors.length > 0 && result.imported === 0) {
      return { ok: false, message: result.errors.join("; ") }
    }
    if (result.imported === 0) {
      return {
        ok: true,
        message:
          result.skipped > 0
            ? "Portal already has matching stock purchase rows (or Salesforce has none to import)."
            : "No Salesforce Stock Sources found to import.",
        imported: 0,
      }
    }
    return {
      ok: true,
      message: `Imported ${result.imported} stock purchase line${result.imported === 1 ? "" : "s"} from Salesforce (inventory unchanged).`,
      imported: result.imported,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Stock source import failed." }
  }
}

function autoPurchaseOrderNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `PO-${d}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
}

function cleanPurchaseOrderFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120)
  return cleaned || "purchase-order-document"
}

/** Find an existing PO by number (case-insensitive) or create a new one. */
async function resolveOrCreatePurchaseOrderId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    supplier: string
    poNumber?: string | null
    issuedAt?: string | null
    note?: string | null
  },
): Promise<{ ok: true; id: string; linkedExisting: boolean } | { ok: false; message: string }> {
  const supplier = input.supplier.trim()
  if (!supplier) return { ok: false, message: "Supplier is required." }
  if (supplier.length > 200) return { ok: false, message: "Supplier must be 200 characters or fewer." }

  const poNumber = (input.poNumber?.trim() || autoPurchaseOrderNumber()).slice(0, 200)

  let issuedAt: string | null = null
  if (input.issuedAt && input.issuedAt.trim()) {
    const t = input.issuedAt.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      return { ok: false, message: "PO date must be YYYY-MM-DD." }
    }
    issuedAt = t
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 5000) : null

  const { data: existing, error: findErr } = await supabase
    .from("purchase_orders")
    .select("id, supplier")
    .ilike("po_number", poNumber)
    .limit(1)
    .maybeSingle()
  if (findErr) return { ok: false, message: findErr.message }
  if (existing?.id) {
    return { ok: true, id: String(existing.id), linkedExisting: true }
  }

  const { data, error } = await supabase.rpc("admin_create_purchase_order", {
    p_po_number: poNumber,
    p_supplier: supplier,
    p_issued_at: issuedAt,
    p_note: note,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("duplicate key") || m.includes("po_number")) {
      return { ok: false, message: "A purchase order with that number already exists." }
    }
    return { ok: false, message: error.message }
  }
  return { ok: true, id: String(data), linkedExisting: false }
}

async function uploadPurchaseOrderDocumentFromFile(
  gate: Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>,
  purchaseOrderId: string,
  file: File,
): Promise<ActionResult> {
  if (file.size > PO_DOCUMENT_MAX_BYTES) {
    return { ok: false, message: "Attachment must be 20MB or smaller." }
  }
  if (!PO_DOCUMENT_ALLOWED_TYPES.has(file.type)) {
    return { ok: false, message: "Attachment must be a PDF, DOC/DOCX, JPG, PNG, or WebP." }
  }

  const admin = createAdminClient()
  if (!admin) {
    return {
      ok: false,
      message: "SUPABASE_SERVICE_ROLE_KEY is required to upload purchase order documents.",
    }
  }
  const fileName = cleanPurchaseOrderFileName(file.name)
  const filePath = `${purchaseOrderId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`

  const { error: uploadErr } = await admin.storage
    .from(PO_DOCUMENT_BUCKET)
    .upload(filePath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    })
  if (uploadErr) return { ok: false, message: uploadErr.message }

  const { error: insertErr } = await gate.supabase.from("purchase_order_documents").insert({
    purchase_order_id: purchaseOrderId,
    file_bucket: PO_DOCUMENT_BUCKET,
    file_path: filePath,
    file_name: fileName,
    file_content_type: file.type,
    file_size: file.size,
    uploaded_by: gate.profile.id,
  })
  if (insertErr) {
    await admin.storage.from(PO_DOCUMENT_BUCKET).remove([filePath])
    return { ok: false, message: insertErr.message }
  }
  return { ok: true }
}

/** Add stock and create (or link) the purchase order in one step. Optional contract upload. */
export async function addStockPurchaseLayer(formData: FormData): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const packageId = String(formData.get("packageId") ?? "").trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const supplier = String(formData.get("supplier") ?? "").trim()
  if (!supplier) return { ok: false, message: "Supplier is required." }

  const q = Math.floor(Number(formData.get("quantity")))
  if (!Number.isFinite(q) || q <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number." }
  }
  const c = Number(formData.get("unitCost"))
  if (!Number.isFinite(c) || c < 0) {
    return { ok: false, message: "Unit cost must be a non-negative number." }
  }

  const poNumberRaw = String(formData.get("poNumber") ?? "").trim()
  const poIssuedAt = String(formData.get("poIssuedAt") ?? "").trim() || null
  const note = String(formData.get("note") ?? "").trim() || null
  const receivedRaw = String(formData.get("receivedAt") ?? "").trim()
  const fulfilmentBlockId = String(formData.get("fulfilmentBlockId") ?? "").trim() || null
  if (fulfilmentBlockId && !UUID_RE.test(fulfilmentBlockId)) {
    return { ok: false, message: "Invalid fulfilment block id." }
  }

  let received: string | null = null
  if (receivedRaw) {
    const d = new Date(receivedRaw)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: "Received date is not a valid date." }
    }
    received = d.toISOString()
  }

  const { supabase } = gate
  const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
    supplier,
    poNumber: poNumberRaw || null,
    issuedAt: poIssuedAt,
    note,
  })
  if (!resolved.ok) return resolved

  const { error } = await supabase.rpc("admin_add_cost_layer", {
    p_package_id: packageId,
    p_quantity: q,
    p_unit_cost: c,
    p_currency: null,
    p_note: note,
    p_received_at: received,
    p_source: null,
    p_purchase_order_id: resolved.id,
    p_fulfilment_block_id: fulfilmentBlockId,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("fulfilment_block_wrong_package")) {
      return { ok: false, message: "Fulfilment block does not belong to this package." }
    }
    if (m.includes("fulfilment_block_not_found")) {
      return { ok: false, message: "Fulfilment block not found." }
    }
    return { ok: false, message: error.message }
  }

  const rawFile = formData.get("file")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (file) {
    const upload = await uploadPurchaseOrderDocumentFromFile(gate, resolved.id, file)
    if (!upload.ok) return upload
  }

  revalidateAdminProfitPaths(packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")

  const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
    p_package_id: packageId,
  })
  if (bfErr) return { ok: false, message: bfErr.message }
  await reconcileInventoryAfterCostLayerChange(supabase, packageId)

  return {
    ok: true,
    message: resolved.linkedExisting
      ? "Stock added and linked to the existing purchase order."
      : "Stock added with a new purchase order.",
  }
}

export async function addCostLayer(input: {
  packageId: string
  quantity: number
  unitCost: number
  currency?: string | null
  note?: string | null
  source?: string | null
  receivedAt?: string | null
  purchaseOrderId?: string | null
  fulfilmentBlockId?: string | null
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
  const purchaseOrderId = input.purchaseOrderId?.trim() || null
  if (purchaseOrderId && !UUID_RE.test(purchaseOrderId)) {
    return { ok: false, message: "Invalid purchase order id." }
  }
  const fulfilmentBlockId = input.fulfilmentBlockId?.trim() || null
  if (fulfilmentBlockId && !UUID_RE.test(fulfilmentBlockId)) {
    return { ok: false, message: "Invalid fulfilment block id." }
  }
  const { supabase } = gate
  const { error } = await supabase.rpc("admin_add_cost_layer", {
    p_package_id: input.packageId,
    p_quantity: q,
    p_unit_cost: c,
    p_currency: input.currency?.trim() || null,
    p_note: input.note ?? null,
    p_received_at: received,
    p_source: input.source?.trim() || null,
    p_purchase_order_id: purchaseOrderId,
    p_fulfilment_block_id: fulfilmentBlockId,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("fulfilment_block_wrong_package")) {
      return { ok: false, message: "Fulfilment block does not belong to this package." }
    }
    if (m.includes("purchase_order_not_found")) {
      return { ok: false, message: "Purchase order not found." }
    }
    if (m.includes("fulfilment_block_not_found")) {
      return { ok: false, message: "Fulfilment block not found." }
    }
    return { ok: false, message: error.message }
  }
  revalidateAdminProfitPaths(input.packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/packages")
  revalidatePath("/")
  const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
    p_package_id: input.packageId,
  })
  if (bfErr) return { ok: false, message: bfErr.message }
  await enqueueLinkedInventoryChannelSync(supabase, input.packageId)
  return { ok: true }
}

export async function updateCostLayer(input: {
  layerId: string
  packageId?: string | null
  unitCost?: number | null
  currency?: string | null
  note?: string | null
  source?: string | null
  receivedAt?: string | null
  cascadeToConsumptions?: boolean
  /** null = clear, undefined = leave unchanged, string = set. */
  purchaseOrderId?: string | null
  /** null = clear, undefined = leave unchanged, string = set. */
  fulfilmentBlockId?: string | null
  /** Create or update the linked purchase order (supplier always required when set). */
  purchaseOrderSupplier?: string | null
  purchaseOrderNumber?: string | null
  purchaseOrderIssuedAt?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const layerId = input.layerId.trim()
  if (!UUID_RE.test(layerId)) {
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
    p_layer_id: layerId,
    p_unit_cost: cost,
    p_currency: input.currency?.trim() || null,
    p_note: input.note ?? null,
    p_received_at: received,
    p_cascade_to_consumptions: input.cascadeToConsumptions ?? true,
  })
  if (error) return { ok: false, message: error.message }

  const purchaseFieldsProvided =
    input.purchaseOrderSupplier !== undefined ||
    input.purchaseOrderNumber !== undefined ||
    input.purchaseOrderIssuedAt !== undefined

  if (purchaseFieldsProvided) {
    const supplier = input.purchaseOrderSupplier?.trim() ?? ""
    if (!supplier) {
      return { ok: false, message: "Supplier is required for the purchase order." }
    }

    const { data: layerRow, error: layerErr } = await supabase
      .from("package_cost_layers")
      .select("purchase_order_id")
      .eq("id", layerId)
      .maybeSingle()
    if (layerErr) return { ok: false, message: layerErr.message }

    const existingPoId = (layerRow as { purchase_order_id?: string | null } | null)?.purchase_order_id ?? null

    if (existingPoId) {
      const { error: poUpdErr } = await supabase.rpc("admin_update_purchase_order", {
        p_id: existingPoId,
        p_po_number: input.purchaseOrderNumber?.trim() || null,
        p_supplier: supplier,
        p_issued_at: input.purchaseOrderIssuedAt?.trim() || null,
        p_note: null,
        p_clear_issued_at: !input.purchaseOrderIssuedAt?.trim(),
      })
      if (poUpdErr) return { ok: false, message: poUpdErr.message }
    } else {
      const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
        supplier,
        poNumber: input.purchaseOrderNumber?.trim() || null,
        issuedAt: input.purchaseOrderIssuedAt?.trim() || null,
      })
      if (!resolved.ok) return resolved
      const { error: linkErr } = await supabase.rpc("admin_set_cost_layer_purchase_order", {
        p_layer_id: layerId,
        p_purchase_order_id: resolved.id,
        p_clear: false,
      })
      if (linkErr) return { ok: false, message: linkErr.message }
    }
  } else if (input.purchaseOrderId !== undefined) {
    const poId = input.purchaseOrderId?.trim() || null
    if (poId && !UUID_RE.test(poId)) {
      return { ok: false, message: "Invalid purchase order id." }
    }
    const { error: poErr } = await supabase.rpc("admin_set_cost_layer_purchase_order", {
      p_layer_id: layerId,
      p_purchase_order_id: poId,
      p_clear: poId == null,
    })
    if (poErr) {
      const m = poErr.message.toLowerCase()
      if (m.includes("purchase_order_not_found")) {
        return { ok: false, message: "Purchase order not found." }
      }
      return { ok: false, message: poErr.message }
    }
  } else if (input.source !== undefined) {
    const { error: srcErr } = await supabase.rpc("admin_set_cost_layer_source", {
      p_layer_id: layerId,
      p_source: input.source?.trim() || null,
    })
    if (srcErr) return { ok: false, message: srcErr.message }
  }

  if (input.fulfilmentBlockId !== undefined) {
    const blockId = input.fulfilmentBlockId?.trim() || null
    if (blockId && !UUID_RE.test(blockId)) {
      return { ok: false, message: "Invalid fulfilment block id." }
    }
    const { error: blockErr } = await supabase.rpc("admin_set_cost_layer_fulfilment_block", {
      p_layer_id: layerId,
      p_fulfilment_block_id: blockId,
      p_clear: blockId == null,
    })
    if (blockErr) {
      const m = blockErr.message.toLowerCase()
      if (m.includes("fulfilment_block_wrong_package")) {
        return { ok: false, message: "Fulfilment block does not belong to this package." }
      }
      if (m.includes("fulfilment_block_not_found")) {
        return { ok: false, message: "Fulfilment block not found." }
      }
      return { ok: false, message: blockErr.message }
    }
  }

  revalidateAdminProfitPaths(input.packageId?.trim() || undefined)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
  if (input.packageId?.trim()) {
    await enqueueLinkedInventoryChannelSync(supabase, input.packageId.trim())
  }
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
  if (input.packageId?.trim()) {
    await reconcileInventoryAfterCostLayerChange(supabase, input.packageId.trim())
  }
  return { ok: true }
}

export async function deleteCostLayer(layerId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  if (!UUID_RE.test(layerId.trim())) {
    return { ok: false, message: "Invalid cost layer id." }
  }
  const { supabase } = gate
  const { data: layer } = await supabase
    .from("package_cost_layers")
    .select("package_id")
    .eq("id", layerId.trim())
    .maybeSingle()
  const { error } = await supabase.rpc("admin_delete_cost_layer", { p_layer_id: layerId.trim() })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin")
  revalidatePath("/packages")
  revalidatePath("/")
  if (layer?.package_id) {
    await reconcileInventoryAfterCostLayerChange(supabase, String(layer.package_id))
  }
  return { ok: true }
}

/**
 * Edit or clear inventory that exists without any cost-layer / stock-purchase row
 * (legacy seed, SF pull, or manual qty). When supplier + buy price are provided,
 * converts the orphan stock into a real purchase layer without double-counting.
 */
export async function updateOrphanPackageStock(input: {
  packageId: string
  quantity: number
  /** When set with unitCost, creates a cost layer for this stock (replacing the orphan). */
  convertToPurchase?: {
    supplier: string
    unitCost: number
    note?: string | null
    poNumber?: string | null
    poIssuedAt?: string | null
    receivedAt?: string | null
    fulfilmentBlockId?: string | null
  } | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const newQty = Math.floor(Number(input.quantity))
  if (!Number.isFinite(newQty) || newQty < 0) {
    return { ok: false, message: "Quantity must be a non-negative whole number." }
  }

  const { supabase } = gate

  const { count: layerCount, error: layerCountErr } = await supabase
    .from("package_cost_layers")
    .select("id", { count: "exact", head: true })
    .eq("package_id", packageId)
  if (layerCountErr) return { ok: false, message: layerCountErr.message }
  if ((layerCount ?? 0) > 0) {
    return {
      ok: false,
      message: "This package already has stock purchase rows. Edit or delete those instead.",
    }
  }

  const { data: inv, error: invErr } = await supabase
    .from("package_inventory")
    .select("qty_available, qty_held")
    .eq("package_id", packageId)
    .maybeSingle()
  if (invErr) return { ok: false, message: invErr.message }
  if (!inv) return { ok: false, message: "No inventory row for this package." }

  const currentAvailable = Math.max(0, Math.floor(Number(inv.qty_available) || 0))
  const held = Math.max(0, Math.floor(Number(inv.qty_held) || 0))
  if (newQty < held) {
    return {
      ok: false,
      message: `Quantity cannot be less than ${held} (units currently on hold). Release holds first.`,
    }
  }

  const convert = input.convertToPurchase
  if (convert) {
    const supplier = convert.supplier.trim()
    if (!supplier) return { ok: false, message: "Supplier is required to record a stock purchase." }
    const unitCost = Number(convert.unitCost)
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return { ok: false, message: "Buy price must be a non-negative number." }
    }
    if (newQty <= 0) {
      return { ok: false, message: "Quantity must be greater than zero to create a stock purchase." }
    }

    const fulfilmentBlockId = convert.fulfilmentBlockId?.trim() || null
    if (fulfilmentBlockId && !UUID_RE.test(fulfilmentBlockId)) {
      return { ok: false, message: "Invalid fulfilment block id." }
    }

    let received: string | null = null
    if (convert.receivedAt?.trim()) {
      const d = new Date(convert.receivedAt.trim())
      if (Number.isNaN(d.getTime())) {
        return { ok: false, message: "Received date is not a valid date." }
      }
      received = d.toISOString()
    }

    // Zero orphan inventory first, then add_cost_layer restores the new qty — avoids double count.
    if (currentAvailable > 0) {
      const { error: clearErr } = await supabase.rpc("adjust_linked_inventory_available", {
        p_package_id: packageId,
        p_delta: -currentAvailable,
      })
      if (clearErr) return { ok: false, message: clearErr.message }
    }

    const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
      supplier,
      poNumber: convert.poNumber?.trim() || null,
      issuedAt: convert.poIssuedAt?.trim() || null,
      note: convert.note?.trim() || null,
    })
    if (!resolved.ok) {
      // Best-effort restore orphan qty if PO creation failed after clear.
      if (currentAvailable > 0) {
        await supabase.rpc("adjust_linked_inventory_available", {
          p_package_id: packageId,
          p_delta: currentAvailable,
        })
      }
      return resolved
    }

    const { error: addErr } = await supabase.rpc("admin_add_cost_layer", {
      p_package_id: packageId,
      p_quantity: newQty,
      p_unit_cost: unitCost,
      p_currency: null,
      p_note: convert.note?.trim() || "Converted from untracked stock",
      p_received_at: received,
      p_source: null,
      p_purchase_order_id: resolved.id,
      p_fulfilment_block_id: fulfilmentBlockId,
    })
    if (addErr) {
      if (currentAvailable > 0) {
        await supabase.rpc("adjust_linked_inventory_available", {
          p_package_id: packageId,
          p_delta: currentAvailable,
        })
      }
      const m = addErr.message.toLowerCase()
      if (m.includes("fulfilment_block_wrong_package")) {
        return { ok: false, message: "Fulfilment block does not belong to this package." }
      }
      return { ok: false, message: addErr.message }
    }

    const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
      p_package_id: packageId,
    })
    if (bfErr) return { ok: false, message: bfErr.message }

    revalidateAdminProfitPaths(packageId)
    revalidatePath("/admin/inventory")
    revalidatePath("/admin/purchase-orders")
    revalidatePath("/admin/catalog")
    revalidatePath("/packages")
    revalidatePath("/")
    await enqueueLinkedInventoryChannelSync(supabase, packageId)
    return { ok: true, message: "Untracked stock converted to a stock purchase." }
  }

  const delta = newQty - currentAvailable
  if (delta !== 0) {
    const { error: adjErr } = await supabase.rpc("adjust_linked_inventory_available", {
      p_package_id: packageId,
      p_delta: delta,
    })
    if (adjErr) return { ok: false, message: adjErr.message }
  }

  revalidateAdminProfitPaths(packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")
  await enqueueLinkedInventoryChannelSync(supabase, packageId)
  return {
    ok: true,
    message: newQty === 0 ? "Untracked stock cleared." : "Untracked stock quantity updated.",
  }
}

export async function deletePackage(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const { supabase } = gate

  const { data: pkg, error: pkgErr } = await supabase
    .from("packages")
    .select("id, race_id, inventory_group_id, shell_parent_package_id")
    .eq("id", id)
    .maybeSingle()
  if (pkgErr) return { ok: false, message: pkgErr.message }
  if (!pkg) return { ok: false, message: "Package not found." }

  const pkgMeta = pkg as {
    race_id: string
    inventory_group_id: string | null
    shell_parent_package_id: string | null
  }
  const preserveSalesforceProduct =
    !!pkgMeta.inventory_group_id?.trim() && !pkgMeta.shell_parent_package_id?.trim()

  const { data: shellRowsForOrderCheck } = await supabase
    .from("packages")
    .select("id")
    .eq("shell_parent_package_id", id)
  const shellIdsForOrderCheck = (shellRowsForOrderCheck ?? []).map((row) => String((row as { id: string }).id))
  const packageIdsForOrderCheck = [id, ...shellIdsForOrderCheck]

  const { count, error: orderErr } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("package_id", packageIdsForOrderCheck)
  if (orderErr) return { ok: false, message: orderErr.message }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Cannot delete: ${count} order${count === 1 ? "" : "s"} reference this package or its Single Ticket children. Cancel or keep the package for records.`,
    }
  }

  const wix = await deleteWixProductsForPackage(id)
  if (wix.errors.length > 0) {
    return {
      ok: false,
      message: `Wix product could not be deleted: ${wix.errors.join(" · ")}`,
    }
  }

  // Delete Salesforce products for any auto-created Single Ticket shell children first, so
  // the SF Product2 records don't linger after their portal parent is gone. The shell portal
  // rows themselves cascade-delete when the parent row is removed below.
  const shellDeleteErrors: string[] = []
  const shellDeletedIds: string[] = []
  for (const shellId of shellIdsForOrderCheck) {
    const shellSf = await deleteSalesforceProductForPackage(shellId)
    if (shellSf.error) {
      shellDeleteErrors.push(`${shellId}${shellSf.product2Id ? ` (${shellSf.product2Id})` : ""}: ${shellSf.error}`)
    } else if (shellSf.deleted && shellSf.product2Id) {
      shellDeletedIds.push(shellSf.product2Id)
    }
  }
  if (shellDeleteErrors.length > 0) {
    return {
      ok: false,
      message: `Shell single ticket Salesforce product(s) could not be deleted: ${shellDeleteErrors.join(" · ")}`,
    }
  }

  const sf = preserveSalesforceProduct
    ? { deleted: false, product2Id: null, error: null, skipped: true }
    : await deleteSalesforceProductForPackage(id)
  if (sf.error) {
    return {
      ok: false,
      message: `Salesforce product could not be deleted${sf.product2Id ? ` (${sf.product2Id})` : ""}: ${sf.error}`,
    }
  }

  const { error: bookingErr } = await supabase.from("booking_approval_requests").delete().eq("package_id", id)
  if (bookingErr) return { ok: false, message: bookingErr.message }

  const { error } = await supabase.from("packages").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }

  const raceId = pkgMeta.race_id
  const notes: string[] = ["Package deleted from portal."]
  if (preserveSalesforceProduct) {
    notes.push("Salesforce product kept (linked inventory group — relink a new portal package to it if needed).")
  }
  if (wix.deleted.length > 0) notes.push(`Wix: ${wix.deleted.length} product${wix.deleted.length === 1 ? "" : "s"} removed.`)
  if (sf.deleted && sf.product2Id) notes.push(`Salesforce product ${sf.product2Id} removed.`)
  if (shellDeletedIds.length > 0) {
    notes.push(`Shell single ticket product${shellDeletedIds.length === 1 ? "" : "s"} removed (${shellDeletedIds.length}).`)
  }

  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/orders")
  revalidatePath("/admin/integrations/wix")
  revalidatePath("/admin/integrations/salesforce")
  revalidatePath("/admin")
  revalidatePath("/packages")
  revalidatePath("/")
  revalidatePath(`/packages/race/${raceId}`)
  return { ok: true, message: notes.join(" ") }
}

export async function approveBookingRequest(
  requestId: string,
  preferredCostLayerId?: string | null,
): Promise<ActionResult & { orderReference?: string }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const result = await executeBookingApproval(requestId, {
    adminSupabase: gate.supabase,
    preferredCostLayerId,
  })
  if (!result.ok) return { ok: false, message: result.message }

  revalidatePath("/admin/booking-requests")
  revalidatePath("/admin/orders")
  revalidatePath("/bookings")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  return { ok: true, orderReference: result.orderReference }
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

// ---------------------------------------------------------------------------
// Shell Single Ticket backfill
// ---------------------------------------------------------------------------

export async function backfillShellSingleTicketsForAllThreeDayPackages(): Promise<
  | {
      ok: true
      processed: number
      shellsCreated: number
      queued: number
      errors: string[]
    }
  | { ok: false; message: string }
> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const { data: parents, error } = await supabase
    .from("packages")
    .select("id")
    .eq("duration", "3_day")
    .is("shell_parent_package_id", null)
    .order("name")

  if (error) return { ok: false, message: error.message }

  let processed = 0
  let shellsCreated = 0
  let queued = 0
  const errors: string[] = []

  for (const row of parents ?? []) {
    const parentId = typeof row.id === "string" ? row.id.trim() : ""
    if (!parentId) continue
    processed++

    try {
      const shells = await ensureShellSingleTicketsForParent(supabase, parentId)
      shellsCreated += shells.created.length
    } catch (e) {
      errors.push(`${parentId}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const enq = await enqueueProductUpsert(supabase, parentId)
    if (enq.ok) queued++
    else errors.push(`${parentId}: sync queue — ${enq.message}`)
  }

  revalidatePath("/admin/catalog")
  revalidatePath("/admin/integrations/salesforce")
  return { ok: true, processed, shellsCreated, queued, errors }
}

// ---------------------------------------------------------------------------
// Linked day-group inventory repair
// ---------------------------------------------------------------------------
//
// Copy each linked package's sellable qty from its Salesforce Product2, then min() the 3-day.
export async function repairLinkedDayGroupInventory(input: {
  parentPackageId: string
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const result = await repairLinkedGroupInventory(input.parentPackageId)
  if (!result.ok) return result

  // Do NOT enqueue a product sync here — that schedules an outbox drain which runs
  // pullInventoryFromSalesforce first, and the pull used to read SF Available=0 and
  // immediately undo the repair. Repair already writes SF Available directly.

  const { data: pkg } = await gate.supabase
    .from("packages")
    .select("race_id")
    .eq("id", input.parentPackageId.trim())
    .maybeSingle()
  if (pkg?.race_id) revalidatePackagePaths(String(pkg.race_id))

  const suffix = result.warnings.length > 0 ? ` (${result.warnings.join(" · ")})` : ""
  return { ok: true, message: `${result.message}${suffix}` }
}

// ---------------------------------------------------------------------------
// Salesforce Product2 re-link
// ---------------------------------------------------------------------------
//
// When the auto-create step already made a fresh Product2 in Salesforce (because the portal
// name didn't match any existing SF product exactly), admins can point the portal package at
// a pre-existing Product2 Id here. The next sync will PATCH that record instead of INSERTing
// a new one.
//
// WARNING: syncPackageToSalesforce PATCHes Name, Family, Description on whatever Product2 the
// portal is linked to. Stock/Available are NOT pushed for linked inventory groups (SF owns them).
// that this portal package "owns" — never to a shared single ticket used by other 3-days.
const SALESFORCE_PRODUCT2_ID_RE = /^[a-zA-Z0-9]{15,18}$/

export async function relinkPackageToSalesforceProduct(input: {
  packageId: string
  salesforceProductId: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const { supabase } = gate

  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Package id is required." }

  const raw = (input.salesforceProductId ?? "").trim()
  const nextId = raw.length === 0 ? null : raw

  if (nextId != null && !SALESFORCE_PRODUCT2_ID_RE.test(nextId)) {
    return {
      ok: false,
      message: `Salesforce Product2 Id must be 15–18 alphanumeric characters (got "${nextId}").`,
    }
  }

  const { data: existing, error: exErr } = await supabase
    .from("packages")
    .select("race_id, salesforce_product_id, inventory_group_id, duration, shell_parent_package_id")
    .eq("id", packageId)
    .maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const existingId =
    typeof (existing as { salesforce_product_id: string | null }).salesforce_product_id === "string"
      ? ((existing as { salesforce_product_id: string }).salesforce_product_id.trim() || null)
      : null

  if (existingId === nextId) {
    return { ok: true, message: "Salesforce Product Id unchanged." }
  }

  const { error: updErr } = await supabase
    .from("packages")
    .update({
      salesforce_product_id: nextId,
      integration_sync_status: "pending",
      integration_sync_error: null,
    })
    .eq("id", packageId)
  if (updErr) return { ok: false, message: updErr.message }

  const enq = await enqueueProductUpsert(supabase, packageId)
  if (!enq.ok) return { ok: false, message: enq.message }

  const existingRow = existing as {
    race_id: string
    inventory_group_id: string | null
    duration: string | null
    shell_parent_package_id: string | null
  }
  if (nextId && existingRow.inventory_group_id?.trim() && !existingRow.shell_parent_package_id?.trim()) {
    const { data: threeDay } = await supabase
      .from("packages")
      .select("id")
      .eq("inventory_group_id", existingRow.inventory_group_id.trim())
      .eq("duration", "3_day")
      .limit(1)
      .maybeSingle()
    if (threeDay?.id) {
      const repair = await repairLinkedGroupInventory(String(threeDay.id))
      if (!repair.ok) {
        console.warn("[relinkPackageToSalesforceProduct] Linked inventory repair:", repair.message)
      }
    }
  }

  if (nextId) {
    try {
      await pullInventoryFromSalesforce({ force: true })
    } catch (e) {
      console.warn(
        "[relinkPackageToSalesforceProduct] SF inventory pull after relink:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  revalidatePackagePaths(existingRow.race_id)
  return {
    ok: true,
    message: nextId
      ? `Package linked to Salesforce Product2 ${nextId}. Inventory pulled from Salesforce for the linked group.`
      : "Salesforce Product Id cleared. Next sync will match an existing product on the event if one exists, otherwise auto-create.",
  }
}

// ============================================================================
// Purchase Orders + Fulfilment Blocks
// ============================================================================

type PurchaseOrderIdResult = { ok: true; id: string } | { ok: false; message: string }

export async function createPurchaseOrder(input: {
  poNumber: string
  supplier: string
  issuedAt?: string | null
  note?: string | null
}): Promise<PurchaseOrderIdResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const poNumber = input.poNumber.trim()
  const supplier = input.supplier.trim()
  if (!poNumber) return { ok: false, message: "PO number is required." }
  if (poNumber.length > 200) return { ok: false, message: "PO number must be 200 characters or fewer." }
  if (!supplier) return { ok: false, message: "Supplier is required." }
  if (supplier.length > 200) return { ok: false, message: "Supplier must be 200 characters or fewer." }

  let issuedAt: string | null = null
  if (input.issuedAt && input.issuedAt.trim()) {
    const t = input.issuedAt.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      return { ok: false, message: "Issued date must be YYYY-MM-DD." }
    }
    issuedAt = t
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 5000) : null

  const { data, error } = await gate.supabase.rpc("admin_create_purchase_order", {
    p_po_number: poNumber,
    p_supplier: supplier,
    p_issued_at: issuedAt,
    p_note: note,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("duplicate key") || m.includes("po_number")) {
      return { ok: false, message: "A purchase order with that number already exists." }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  return { ok: true, id: String(data) }
}

export async function updatePurchaseOrder(input: {
  id: string
  poNumber?: string | null
  supplier?: string | null
  issuedAt?: string | null
  clearIssuedAt?: boolean
  note?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = input.id.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid purchase order id." }

  let issuedAt: string | null = null
  if (input.issuedAt && input.issuedAt.trim()) {
    const t = input.issuedAt.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      return { ok: false, message: "Issued date must be YYYY-MM-DD." }
    }
    issuedAt = t
  }

  const { error } = await gate.supabase.rpc("admin_update_purchase_order", {
    p_id: id,
    p_po_number: input.poNumber?.trim() || null,
    p_supplier: input.supplier?.trim() || null,
    p_issued_at: issuedAt,
    p_note: input.note ?? null,
    p_clear_issued_at: input.clearIssuedAt ?? false,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("purchase_order_not_found")) {
      return { ok: false, message: "Purchase order not found." }
    }
    if (m.includes("duplicate key") || m.includes("po_number")) {
      return { ok: false, message: "A purchase order with that number already exists." }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  return { ok: true }
}

export async function deletePurchaseOrder(purchaseOrderId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = purchaseOrderId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid purchase order id." }

  // Best-effort: also delete stored attachment files.
  const { data: docs } = await gate.supabase
    .from("purchase_order_documents")
    .select("file_bucket, file_path")
    .eq("purchase_order_id", id)

  const { error } = await gate.supabase.rpc("admin_delete_purchase_order", { p_id: id })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("purchase_order_in_use")) {
      return { ok: false, message: "Cannot delete: this PO is linked to one or more cost layers. Unlink them first." }
    }
    if (m.includes("purchase_order_not_found")) {
      return { ok: false, message: "Purchase order not found." }
    }
    return { ok: false, message: error.message }
  }

  const paths = (docs ?? [])
    .map((d) => String((d as { file_path?: string }).file_path ?? "").trim())
    .filter((p) => p.length > 0)
  if (paths.length > 0) {
    const admin = createAdminClient()
    if (admin) {
      await admin.storage.from(PO_DOCUMENT_BUCKET).remove(paths)
    }
  }

  revalidatePath("/admin/purchase-orders")
  return { ok: true }
}

export async function uploadPurchaseOrderDocument(formData: FormData): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "").trim()
  if (!UUID_RE.test(purchaseOrderId)) return { ok: false, message: "Invalid purchase order id." }

  const raw = formData.get("file")
  const file = raw instanceof File && raw.size > 0 ? raw : null
  if (!file) return { ok: false, message: "Select a file to upload." }
  if (file.size > PO_DOCUMENT_MAX_BYTES) {
    return { ok: false, message: "Attachment must be 20MB or smaller." }
  }
  if (!PO_DOCUMENT_ALLOWED_TYPES.has(file.type)) {
    return { ok: false, message: "Attachment must be a PDF, DOC/DOCX, JPG, PNG, or WebP." }
  }

  const { data: po, error: poErr } = await gate.supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", purchaseOrderId)
    .maybeSingle()
  if (poErr) return { ok: false, message: poErr.message }
  if (!po) return { ok: false, message: "Purchase order not found." }

  const admin = createAdminClient()
  if (!admin) {
    return {
      ok: false,
      message: "SUPABASE_SERVICE_ROLE_KEY is required to upload purchase order documents.",
    }
  }
  const fileName = cleanPurchaseOrderFileName(file.name)
  const filePath = `${purchaseOrderId}/${Date.now()}-${crypto.randomUUID()}-${fileName}`

  const { error: uploadErr } = await admin.storage
    .from(PO_DOCUMENT_BUCKET)
    .upload(filePath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    })
  if (uploadErr) return { ok: false, message: uploadErr.message }

  const { error: insertErr } = await gate.supabase.from("purchase_order_documents").insert({
    purchase_order_id: purchaseOrderId,
    file_bucket: PO_DOCUMENT_BUCKET,
    file_path: filePath,
    file_name: fileName,
    file_content_type: file.type,
    file_size: file.size,
    uploaded_by: gate.profile.id,
  })
  if (insertErr) {
    await admin.storage.from(PO_DOCUMENT_BUCKET).remove([filePath])
    return { ok: false, message: insertErr.message }
  }

  revalidatePath("/admin/purchase-orders")
  return { ok: true }
}

export async function deletePurchaseOrderDocument(documentId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = documentId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid document id." }

  const { data: doc, error } = await gate.supabase
    .from("purchase_order_documents")
    .select("id, file_bucket, file_path")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!doc) return { ok: false, message: "Attachment not found." }

  const { error: delErr } = await gate.supabase
    .from("purchase_order_documents")
    .delete()
    .eq("id", id)
  if (delErr) return { ok: false, message: delErr.message }

  const path = String((doc as { file_path?: string }).file_path ?? "").trim()
  const bucket = String((doc as { file_bucket?: string }).file_bucket ?? PO_DOCUMENT_BUCKET)
  if (path) {
    const admin = createAdminClient()
    if (admin) await admin.storage.from(bucket).remove([path])
  }

  revalidatePath("/admin/purchase-orders")
  return { ok: true }
}

export async function getPurchaseOrderDocumentDownloadUrl(
  documentId: string,
): Promise<UrlActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = documentId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid document id." }

  const { data: doc, error } = await gate.supabase
    .from("purchase_order_documents")
    .select("file_bucket, file_path, file_name")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  const bucket = String((doc as { file_bucket?: string })?.file_bucket ?? PO_DOCUMENT_BUCKET)
  const path = String((doc as { file_path?: string })?.file_path ?? "").trim()
  const fileName = String((doc as { file_name?: string })?.file_name ?? "").trim() || "attachment"
  if (!path) return { ok: false, message: "Attachment file is missing." }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is required to open PO documents." }

  const { data, error: signedErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 300, { download: fileName })
  if (signedErr || !data?.signedUrl) {
    return { ok: false, message: signedErr?.message ?? "Could not generate download link." }
  }
  return { ok: true, url: data.signedUrl }
}

// -------------------- Fulfilment blocks --------------------

type FulfilmentBlockIdResult = { ok: true; id: string } | { ok: false; message: string }

export async function createFulfilmentBlock(input: {
  packageId: string
  name: string
  locationNote?: string | null
}): Promise<FulfilmentBlockIdResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Package id is required." }
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Block name is required." }
  if (name.length > 60) return { ok: false, message: "Block name must be 60 characters or fewer (Salesforce limit)." }

  const { data, error } = await gate.supabase.rpc("admin_create_fulfilment_block", {
    p_package_id: packageId,
    p_name: name,
    p_location_note: input.locationNote?.trim() || null,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("duplicate key")) {
      return { ok: false, message: "A fulfilment block with that name already exists for this package." }
    }
    if (m.includes("package_not_found")) {
      return { ok: false, message: "Package not found." }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  return { ok: true, id: String(data) }
}

export async function updateFulfilmentBlock(input: {
  id: string
  packageId?: string | null
  name?: string | null
  locationNote?: string | null
  salesforceBlockRef?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = input.id.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid fulfilment block id." }
  const name = input.name?.trim()
  if (name && name.length > 60) {
    return { ok: false, message: "Block name must be 60 characters or fewer (Salesforce limit)." }
  }

  const { error } = await gate.supabase.rpc("admin_update_fulfilment_block", {
    p_id: id,
    p_name: name || null,
    p_location_note: input.locationNote ?? null,
    p_salesforce_block_ref: input.salesforceBlockRef ?? null,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("fulfilment_block_not_found")) {
      return { ok: false, message: "Fulfilment block not found." }
    }
    return { ok: false, message: error.message }
  }
  if (input.packageId?.trim()) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(input.packageId.trim())}`)
  }
  return { ok: true }
}

export async function deleteFulfilmentBlock(input: {
  id: string
  packageId?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = input.id.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Invalid fulfilment block id." }

  const { error } = await gate.supabase.rpc("admin_delete_fulfilment_block", { p_id: id })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("fulfilment_block_in_use")) {
      return {
        ok: false,
        message: "Cannot delete: this block is linked to cost layers. Move those layers to another block first.",
      }
    }
    if (m.includes("fulfilment_block_not_found")) {
      return { ok: false, message: "Fulfilment block not found." }
    }
    return { ok: false, message: error.message }
  }
  if (input.packageId?.trim()) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(input.packageId.trim())}`)
  }
  return { ok: true }
}

export async function fetchAdminCatalogList(): Promise<import("@/lib/admin/queries").AdminPackageRow[]> {
  const gate = await requireAdminAction()
  if (!gate.ok) return []
  // Linked inventory is healed by cron + package detail — not on every catalog list load
  // (portal-only reconcile ignored open SF pipeline and burned no SF API but still
  // corrupted sellable; full SF heal here burned TotalRequests).
  const { getAdminCatalogListRows } = await import("@/lib/admin/queries")
  return getAdminCatalogListRows()
}

export async function fetchAdminPackageForCatalogExpand(
  packageId: string,
): Promise<{
  pkg: import("@/lib/admin/queries").AdminPackageRow
  linkedPackages: import("@/lib/admin/linked-inventory").LinkedInventoryPackage[]
  wixListings: import("@/lib/admin/wix-channel-listings").WixChannelListingRow[]
} | null> {
  const gate = await requireAdminAction()
  if (!gate.ok) return null

  const id = packageId.trim()
  if (!id) return null

  const { getAdminPackageById, getLinkedInventoryPackages } = await import("@/lib/admin/queries")
  const { enrichPackageSalesBreakdownWithOpenPipeline } = await import(
    "@/lib/admin/package-sales-breakdown-sf"
  )
  const { getWixChannelListingsForPackage } = await import("@/lib/admin/wix-channel-listings")

  const [pkg, wixListings] = await Promise.all([
    getAdminPackageById(id),
    getWixChannelListingsForPackage(id),
  ])
  if (!pkg) return null

  const groupId = pkg.inventory_group_id?.trim() || null
  const linkedPackages = groupId ? await getLinkedInventoryPackages(groupId) : []

  // Same SF enrichment as the full product page — without it, Places Sold / Stock Purchased
  // stay at portal offline=0 while the detail page shows live Closed Won.
  const breakdowns = new Map<string, typeof pkg.sales_breakdown>()
  breakdowns.set(pkg.id, pkg.sales_breakdown)
  for (const lp of linkedPackages) {
    if (lp.id === pkg.id) {
      lp.sales_breakdown = pkg.sales_breakdown
      continue
    }
    breakdowns.set(lp.id, lp.sales_breakdown)
  }

  await enrichPackageSalesBreakdownWithOpenPipeline(breakdowns, [
    { id: pkg.id, salesforce_product_id: pkg.salesforce_product_id ?? null },
    ...linkedPackages.map((p) => ({ id: p.id, salesforce_product_id: p.salesforce_product_id })),
  ])

  return { pkg, linkedPackages, wixListings }
}

export async function fetchInventoryCsvRows(): Promise<import("@/lib/admin/queries").AdminPackageRow[]> {
  const gate = await requireAdminAction()
  if (!gate.ok) return []
  const { getAdminPackageRows } = await import("@/lib/admin/queries")
  return getAdminPackageRows({ includeCostLayers: true, includeSalesforceInventory: true })
}

