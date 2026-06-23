"use server"

import { revalidatePath } from "next/cache"
import { revalidateAdminProfitPaths } from "@/lib/admin/revalidate-profit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { sanitizeHttpsUrl, sanitizeHttpsUrlList } from "@/lib/auth/safe-url"
import { normalizeCatalogImageUrl, normalizeCatalogImageUrlList } from "@/lib/images/display-image-url"
import { deriveInventoryGroupId, isMultiDayComboDuration } from "@/lib/catalog/inventory-group"
import { generatePackageIdFromRaceAndName } from "@/lib/catalog/generate-package-id"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"
import { inferPackageDurationFromName, isValidPackageDuration } from "@/lib/catalog/package-duration"
import { sendBookingApprovalRejectedEmail } from "@/lib/email/send-booking-approval-rejected"
import { executeBookingApproval } from "@/lib/booking-approval/execute-approval"
import { mapPlaceOrderError } from "@/lib/orders/place-order-errors"
import { getPortalProfile } from "@/lib/supabase/profile"
import { isInvoiceWorkflowStatus, normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { enqueuePackageInventoryChannelSync, enqueueProductUpsert } from "@/lib/integrations/enqueue"
import { enqueueOpportunityOutcomeServer, enqueueOrderIntegrationsServer } from "@/lib/integrations/enqueue-server"
import { drainOutboxNow } from "@/lib/integrations/schedule-drain"
import { processIntegrationOutbox } from "@/lib/integrations/process-outbox"
import { pullInventoryFromSalesforce } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"
import { syncPackageCatalogToWix } from "@/lib/integrations/wix/catalog-sync"
import { createWixProductForPackage as createWixProductForPackageApi } from "@/lib/integrations/wix/create-product"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { deleteWixProductsForPackage } from "@/lib/integrations/wix/delete-product"
import { deleteSalesforceProductForPackage } from "@/lib/integrations/salesforce/delete-product"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"

type ActionResult = { ok: true; message?: string } | { ok: false; message: string }
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

  const { data: existing, error: exErr } = await supabase.from("packages").select("race_id").eq("id", id).maybeSingle()
  if (exErr) return { ok: false, message: exErr.message }
  if (!existing) return { ok: false, message: "Package not found." }

  const { error } = await supabase
    .from("packages")
    .update({
      product_code: productCode,
      salesforce_product_id: input.salesforce_product_id?.trim() || null,
      retail_price_multiplier: mult,
      sell_on_trade_portal: input.sell_on_trade_portal,
      sell_on_wix: input.sell_on_wix,
      sell_on_partners: input.sell_on_partners,
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

export async function retryPackageIntegrationSync(packageId: string): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const id = packageId.trim()
  if (!id) return { ok: false, message: "Package id is missing." }

  const enq = await enqueueProductUpsert(gate.supabase, id, { retry: true })
  if (!enq.ok) return { ok: false, message: enq.message }

  const result = await drainOutboxNow({ packageId: id, maxRounds: 12 })
  if (result.skipped) {
    return {
      ok: false,
      message:
        result.message ??
        "Salesforce is not connected. Open Admin → Integrations → Salesforce → Connect, then try again.",
    }
  }

  const fail = result.failures?.find((f) => f.package_id === id)
  if (fail?.error) {
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/integrations/salesforce")
    return { ok: false, message: fail.error }
  }

  const { data: pkg, error } = await gate.supabase
    .from("packages")
    .select("integration_sync_status, integration_sync_error")
    .eq("id", id)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }

  const status = (pkg as { integration_sync_status?: string } | null)?.integration_sync_status
  if (status === "synced") {
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/integrations/salesforce")
    return { ok: true, message: "Synced to Salesforce successfully." }
  }
  if (status === "failed") {
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/integrations/salesforce")
    const err = (pkg as { integration_sync_error?: string | null })?.integration_sync_error
    return { ok: false, message: err ?? "Salesforce sync failed." }
  }

  revalidatePath("/admin/catalog")
  return {
    ok: false,
    message: "Sync is still queued. It will retry automatically within a few minutes.",
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

  const enq = await enqueueProductUpsert(supabase, packageId)
  if (!enq.ok) return { ok: false, message: enq.message }

  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  revalidatePath("/admin/integrations/wix")
  return {
    ok: true,
    message: "Wix mapping saved. Sync queued.",
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
  includes: string[]
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  is_hidden?: boolean
  requires_booking_approval?: boolean
  sort_order: number
  brochure_url: string | null
  product_code?: string | null
  sell_on_wix?: boolean
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
  const image = normalizeCatalogImageUrl(sanitizeHttpsUrl(input.image))
  const gallery = normalizeCatalogImageUrlList(sanitizeHttpsUrlList(input.gallery_images))
  const cc = input.country_code.trim().toUpperCase().slice(0, 8)

  const inventoryGroupId = deriveInventoryGroupId(id, duration || null, raceId)
  const requiresBookingApproval =
    input.requires_booking_approval ?? isPaddockClubPackageName(input.name.trim())

  const productCode = normalizeProductCode(input.product_code)
  const codeErr = await validateUniqueProductCode(supabase, productCode)
  if (codeErr) return { ok: false, message: codeErr }

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
    sell_on_trade_portal: true,
    sell_on_wix: input.sell_on_wix ?? false,
    sell_on_partners: false,
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
    const siblingIds = (siblings ?? []).map((s) => s.id)
    if (siblingIds.length > 0) {
      const { data: invRows } = await supabase
        .from("package_inventory")
        .select("package_id, qty_available")
        .in("package_id", siblingIds)
      const invBy = new Map((invRows ?? []).map((r) => [r.package_id, r.qty_available]))
      const sat = (siblings ?? []).find((s) => s.duration === "saturday_only")
      const sun = (siblings ?? []).find((s) => s.duration === "sunday_only")
      const multiDay = (siblings ?? []).find((s) => isMultiDayComboDuration(s.duration))
      const dur = duration || ""
      let seedQty: number | null = null
      if (dur === "saturday_only" || dur === "sunday_only") {
        const peer = (siblings ?? []).find((s) => s.duration === dur)
        if (peer) seedQty = invBy.get(peer.id) ?? null
        else if (dur === "sunday_only" && sat) seedQty = invBy.get(sat.id) ?? null
        else if (dur === "saturday_only" && sun) seedQty = invBy.get(sun.id) ?? null
        else if (multiDay) seedQty = invBy.get(multiDay.id) ?? null
      } else if (isMultiDayComboDuration(dur)) {
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
      p_source: input.initial_source?.trim() || null,
    })
    if (layerErr) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return { ok: false, message: layerErr.message }
    }
  }

  let wixNote: string | undefined
  const sellOnWix = input.sell_on_wix === true
  const canAutoCreateWix =
    sellOnWix &&
    !input.is_enquiry &&
    input.trade_price != null &&
    input.trade_price > 0

  if (canAutoCreateWix) {
    if (!isWixConfigured()) {
      console.warn(
        "[createPackage] Wix API is not configured — package saved without a Wix Stores product.",
      )
    } else {
      try {
        await createWixProductForPackageApi(id)
        revalidatePath("/admin/integrations/wix")
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        console.warn("[createPackage] Wix product was not created:", detail)
      }
    }
  }

  await enqueuePackageInventoryChannelSync(supabase, id)

  revalidatePackagePaths(input.race_id.trim())
  revalidatePath("/admin")
  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)

  return { ok: true, message: "Package created." }
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

/** Pull offline Salesforce sales into portal inventory, then push siblings to SF + Wix. */
export async function pullSalesforceInventoryNow(): Promise<
  | {
      ok: true
      pull: Awaited<ReturnType<typeof pullInventoryFromSalesforce>>
      outbox: Awaited<ReturnType<typeof drainOutboxNow>>
    }
  | { ok: false; message: string }
> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  try {
    const pull = await pullInventoryFromSalesforce({ force: true })
    if (pull.skipped) {
      return { ok: false, message: pull.message ?? "Salesforce inventory pull was skipped." }
    }
    const outbox = await drainOutboxNow({ maxRounds: 15 })
    revalidatePath("/admin/integrations/salesforce")
    revalidatePath("/admin/catalog")
    revalidatePath("/admin/inventory")
    return { ok: true, pull, outbox }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Salesforce inventory pull failed." }
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
    p_source: input.source?.trim() || null,
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

  if (input.source !== undefined) {
    const { error: srcErr } = await supabase.rpc("admin_set_cost_layer_source", {
      p_layer_id: input.layerId.trim(),
      p_source: input.source?.trim() || null,
    })
    if (srcErr) return { ok: false, message: srcErr.message }
  }

  revalidateAdminProfitPaths(input.packageId?.trim() || undefined)
  revalidatePath("/admin/inventory")
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
    await enqueueLinkedInventoryChannelSync(supabase, input.packageId.trim())
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
    await enqueueLinkedInventoryChannelSync(supabase, String(layer.package_id))
  }
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

  const wix = await deleteWixProductsForPackage(id)
  if (wix.errors.length > 0) {
    return {
      ok: false,
      message: `Wix product could not be deleted: ${wix.errors.join(" · ")}`,
    }
  }

  const sf = await deleteSalesforceProductForPackage(id)
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

  const raceId = (pkg as { race_id: string }).race_id
  const notes: string[] = ["Package deleted from portal."]
  if (wix.deleted.length > 0) notes.push(`Wix: ${wix.deleted.length} product${wix.deleted.length === 1 ? "" : "s"} removed.`)
  if (sf.deleted && sf.product2Id) notes.push(`Salesforce product ${sf.product2Id} removed.`)

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
): Promise<ActionResult & { orderReference?: string }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const result = await executeBookingApproval(requestId, { adminSupabase: gate.supabase })
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
