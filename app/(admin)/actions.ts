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
import { isEventCategory, type EventCategory } from "@/lib/catalog/event-categories"
import { sendBookingApprovalRejectedEmail } from "@/lib/email/send-booking-approval-rejected"
import { executeBookingApproval } from "@/lib/booking-approval/execute-approval"
import { mapPlaceOrderError } from "@/lib/orders/place-order-errors"
import { getPortalProfile } from "@/lib/supabase/profile"
import { hasCmsPermission, isCmsStaff, type CmsPermission } from "@/lib/auth/permissions"
import { isInvoiceWorkflowStatus, normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { enqueuePackageInventoryChannelSync, enqueueProductUpsert } from "@/lib/integrations/enqueue"
import { repairLinkedGroupInventory } from "@/lib/inventory/repair-linked-group"
import { prepareOrderCancelRelease } from "@/lib/inventory/prepare-order-cancel-release"
import {
  orderCancelMustSkipCogsDelete,
  postgresErrorText,
  releaseOrderStockSkippingRestatedCogs,
  shouldUseRestatementSafeOrderCancel,
} from "@/lib/inventory/cancel-order-stock"
import { recordPurchaseLedgerForLatestLayer } from "@/lib/inventory/ledger"
import {
  ensureSupplierForAccount,
  linkPurchaseOrderToAccount,
} from "@/lib/inventory/suppliers"
import { resolveLinkedStockLedger } from "@/lib/inventory/linked-stock-ledger"
import {
  costDaySlotsForDuration,
  dayLabel,
  deriveTradePriceDayWeights,
  validateManualDayPercentages,
  type CostDaySlot,
} from "@/lib/inventory/day-cost-allocation"
import { getCrmCompanyOptions } from "@/lib/crm/deals"
import {
  generatePurchaseOrderNumber,
  setPurchaseOrderSupplierReference,
} from "@/lib/admin/purchase-orders"
import { isNativePlatformMode } from "@/lib/platform/runtime-mode"
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

async function remapToLinkedStockLedger(
  supabase: Awaited<ReturnType<typeof createClient>>,
  packageId: string,
  fulfilmentBlockId: string | null = null,
): Promise<{ packageId: string; fulfilmentBlockId: string | null }> {
  const ledger = await resolveLinkedStockLedger(supabase, packageId)
  if (!ledger.usedParentLedger) {
    return { packageId, fulfilmentBlockId }
  }
  return { packageId: ledger.ledgerPackageId, fulfilmentBlockId: null }
}

type CostLayerRpcInput = {
  packageId: string
  sourcePackageId: string
  quantity: number
  unitCost: number
  currency: string | null
  note: string | null
  receivedAt: string | null
  source: string | null
  purchaseOrderId: string | null
  fulfilmentBlockId?: string | null
}

function isMissingRpcSignature(error: { code?: string; message: string } | null): boolean {
  if (!error) return false
  const message = error.message.toLowerCase()
  return error.code === "PGRST202" || message.includes("could not find the function")
}

function linkedDayCostErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  const marker = "missing_day_trade_prices"
  if (normalized.includes(marker)) {
    const suffix = message.slice(normalized.indexOf(marker) + marker.length)
    const days = suffix
      .replace(/^[:\s]+/, "")
      .split(/[,;|]/)
      .map((day) => day.trim().replace(/^["'{\[]+|["'}\]]+$/g, ""))
      .filter((day): day is CostDaySlot =>
        day === "thursday_only" ||
        day === "friday_only" ||
        day === "saturday_only" ||
        day === "sunday_only",
      )
    const labels = [...new Set(days)].map(dayLabel)
    return labels.length > 0
      ? `Add a positive trade price for ${labels.join(" and ")}, or save manual day percentages totaling exactly 100%.`
      : "Add positive trade prices for every included day, or save manual day percentages totaling exactly 100%."
  }
  if (
    normalized.includes("cost_policy_required") ||
    normalized.includes("cost_policy_setup_required") ||
    normalized.includes("day_cost_setup_required")
  ) {
    return "Day cost allocation needs setup. Add all included day trade prices or save manual percentages totaling exactly 100%."
  }
  if (normalized.includes("manual_weights_must_total_one")) {
    return "Manual day percentages must total exactly 100%."
  }
  return message
}

async function addCostLayerWithSourcePackage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: CostLayerRpcInput,
): Promise<{ error: { code?: string; message: string } | null }> {
  const base = {
    p_package_id: input.packageId,
    p_quantity: input.quantity,
    p_unit_cost: input.unitCost,
    p_currency: input.currency,
    p_note: input.note,
    p_received_at: input.receivedAt,
    p_source: input.source,
    p_purchase_order_id: input.purchaseOrderId,
    ...(input.fulfilmentBlockId !== undefined
      ? { p_fulfilment_block_id: input.fulfilmentBlockId }
      : {}),
  }
  if (input.purchaseOrderId) {
    const purchaseOrderLayer = await supabase.rpc(
      "admin_add_purchase_order_cost_layer",
      {
        ...base,
        p_source_package_id: input.sourcePackageId,
      },
    )
    if (!isMissingRpcSignature(purchaseOrderLayer.error)) {
      return { error: purchaseOrderLayer.error }
    }
  }
  const current = await supabase.rpc("admin_add_cost_layer", {
    ...base,
    p_source_package_id: input.sourcePackageId,
  })
  if (!isMissingRpcSignature(current.error)) return { error: current.error }

  // Supports an application-first deployment while the additive migration is
  // still rolling out. Only signature lookup errors fall back; validation and
  // transaction errors from the new function are always returned unchanged.
  const legacy = await supabase.rpc("admin_add_cost_layer", base)
  return { error: legacy.error }
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

  if (isSalesforceConfigured()) {
    try {
      const { syncPackageToSalesforce } = await import("@/lib/integrations/salesforce/products")
      await syncPackageToSalesforce(id)
    } catch (e) {
      console.warn(
        "[admin] Salesforce sync after cost-layer change failed:",
        e instanceof Error ? e.message : e,
      )
    }
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

export async function requireAdminAction(
  permission: CmsPermission = "cms.access",
): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; profile: NonNullable<Awaited<ReturnType<typeof getPortalProfile>>> }
  | { ok: false; message: string }
> {
  const profile = await getPortalProfile()
  if (!profile) return { ok: false, message: "Not signed in." }
  if (!isCmsStaff(profile)) return { ok: false, message: "CMS access required." }
  if (!hasCmsPermission(profile, permission)) {
    return { ok: false, message: "You do not have permission for this action." }
  }
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
  if (orderId && status === "delivered") {
    await supabase
      .from("order_operations")
      .update({
        delivery_status: "delivered",
        fulfilment_status: "delivered",
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
  }
  if (orderId && status === "paid") {
    const enq = await enqueueOpportunityOutcomeServer(String(orderId), "won")
    if (!enq.ok) {
      revalidatePath("/admin/agents")
      revalidatePath("/admin/orders")
      revalidatePath("/bookings")
      revalidatePath("/invoices")
      return {
        ok: true,
        message: `Invoice marked paid. Outcome sync was not queued (${enq.message}). Process the sync queue from Settings → Integrations if needed.`,
      }
    }
  }

  revalidatePath("/admin/agents")
  revalidatePath("/admin/orders")
  revalidatePath("/bookings")
  revalidatePath("/invoices")
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

  try {
    await prepareOrderCancelRelease(id)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not prepare order cancellation."
    if (msg.includes("tickets_or_delivery_block_cancellation")) {
      return {
        ok: false,
        message: "This order cannot be cancelled because tickets have already been received or delivered.",
      }
    }
    return { ok: false, message: msg }
  }

  const skipCogsDelete = await orderCancelMustSkipCogsDelete(id)
  const { data, error } = skipCogsDelete
    ? { data: null, error: { message: "inventory_component_audit_rows_are_append_only" } }
    : await gate.supabase.rpc("admin_cancel_order", { p_order_id: id })
  if (error) {
    const msg = postgresErrorText(error)
    if (msg.includes("already_cancelled")) return { ok: false, message: "This order is already cancelled." }
    if (msg.includes("order_not_found")) return { ok: false, message: "Order not found." }
    if (msg.includes("tickets_or_delivery_block_cancellation")) {
      return {
        ok: false,
        message: "This order cannot be cancelled because tickets have already been received or delivered.",
      }
    }
    if (msg.includes("allocation_fulfilment_locked")) {
      return {
        ok: false,
        message: "Stock cannot be restored because supplier fulfilment has already started.",
      }
    }
    if (shouldUseRestatementSafeOrderCancel(msg)) {
      try {
        const admin = createAdminClient()
        if (!admin) return { ok: false, message: "Supabase service role is not configured." }
        await releaseOrderStockSkippingRestatedCogs(id, "Order cancelled")
        const { data: order } = await admin
          .from("orders")
          .select("package_id, guests, reference")
          .eq("id", id)
          .maybeSingle()
        if (order?.package_id && Number(order.guests) > 0) {
          const { error: availableError } = await admin.rpc("adjust_linked_inventory_available", {
            p_package_id: order.package_id,
            p_delta: Number(order.guests),
          })
          if (availableError) return { ok: false, message: availableError.message }
        }
        const { error: statusError } = await admin.from("orders").update({ status: "cancelled" }).eq("id", id)
        if (statusError) return { ok: false, message: statusError.message }
        if (orderBefore?.id) {
          await enqueueOpportunityOutcomeServer(String(orderBefore.id), "lost")
        }
        const packageId = order?.package_id?.trim()
        if (packageId) {
          await enqueuePackageInventoryChannelSync(gate.supabase, packageId)
        }
        revalidatePath("/admin/orders")
        revalidatePath("/admin/catalog")
        revalidatePath("/admin/inventory")
        revalidatePath("/packages")
        revalidatePath("/bookings")
        revalidateAdminProfitPaths()
        const ref = order?.reference?.trim()
        return {
          ok: true,
          message: ref ? `Cancelled ${ref} and restored stock.` : "Order cancelled and stock restored.",
        }
      } catch (fallbackError) {
        const fallback =
          fallbackError instanceof Error ? fallbackError.message : "Could not cancel this order."
        return { ok: false, message: fallback }
      }
    }
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
      ? `${ref} cancelled. Stock restored.`
      : "Order cancelled. Stock restored.",
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
  inventory_is_standalone?: boolean
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
  const inventoryIsStandalone = input.inventory_is_standalone === true
  const manualInventoryGroupId = input.inventory_group_id?.trim() || null
  const inventoryGroupId = duration && !inventoryIsStandalone
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
      inventory_is_standalone: inventoryIsStandalone,
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

  if (error) {
    if (error.message.toLowerCase().includes("package_inventory_in_use")) {
      return {
        ok: false,
        message:
          "This package still has allocated stock, active holds, orders, or sales without a recorded shortage and cannot be detached safely.",
      }
    }
    return { ok: false, message: error.message }
  }

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
    await supabase.rpc("admin_ensure_inventory_pool_for_group", {
      p_inventory_group_id: inventoryGroupId,
    })
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
  is_hidden?: boolean
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
      ...(input.is_hidden == null ? {} : { is_hidden: input.is_hidden }),
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
    const enq = await enqueueProductUpsert(gate.supabase, id)
    if (!enq.ok) return { ok: false, message: enq.message }
    return { ok: true, message: "Website sync queued." }
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
  const gate = await requireAdminAction("inventory.archive")
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
  revalidatePath("/admin/inventory/sales-list")
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
  inventory_is_standalone?: boolean
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
  /** CRM account to record as the stock source / supplier (creates a PO when initial qty > 0). */
  initial_supplier_account_id?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction("inventory.manage")
  if (!gate.ok) return gate
  const { supabase } = gate

  const raceId = input.race_id.trim()
  const { data: race, error: rErr } = await supabase
    .from("races")
    .select("id, category")
    .eq("id", raceId)
    .maybeSingle()
  if (rErr) return { ok: false, message: rErr.message }
  if (!race) return { ok: false, message: "Event not found." }

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
  const isFormula1 = String((race as { category?: string }).category ?? "formula_1") === "formula_1"
  if (isFormula1 && !duration) {
    return { ok: false, message: "Duration is required. Choose 3 day, 2 day, or a single-day option." }
  }
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

  let retailMultiplier: number | null = input.retail_price_multiplier ?? null
  if (retailMultiplier != null && (!Number.isFinite(retailMultiplier) || retailMultiplier <= 0)) {
    return { ok: false, message: "Wix price multiplier must be a positive number (e.g. 1.1)." }
  }
  let wixRetailPrice: number | null = input.wix_retail_price ?? null
  if (wixRetailPrice != null && (!Number.isFinite(wixRetailPrice) || wixRetailPrice < 0)) {
    return { ok: false, message: "Manual Wix price must be zero or a positive number." }
  }

  const sellOnWix = input.sell_on_wix === true && !input.is_enquiry && input.is_hidden !== true
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

  const inventoryIsStandalone = input.inventory_is_standalone === true
  const manualInventoryGroupId = input.inventory_group_id?.trim() || null
  const inventoryGroupId = duration && !inventoryIsStandalone
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
    inventory_is_standalone: inventoryIsStandalone,
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
        if (dur === "2_day") {
          const sat = siblingRows.find((s) => s.duration === "saturday_only")
          const sun = siblingRows.find((s) => s.duration === "sunday_only")
          const satQty = sat ? invBy.get(sat.id) : null
          const sunQty = sun ? invBy.get(sun.id) : null
          if (satQty != null && sunQty != null) seedQty = Math.min(satQty, sunQty)
          else if (satQty != null) seedQty = satQty
          else if (sunQty != null) seedQty = sunQty
          else {
            const threeDay = siblingRows.find((s) => s.duration === "3_day")
            if (threeDay) seedQty = invBy.get(threeDay.id) ?? null
          }
        } else {
          const dayCaps = siblingRows
            .filter((s) => isDayDuration(s.duration))
            .map((s) => invBy.get(s.id))
            .filter((n): n is number => n != null)
          if (dayCaps.length > 0) seedQty = Math.min(...dayCaps)
        }
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
    const supplierAccountId = input.initial_supplier_account_id?.trim() || ""
    if (!supplierAccountId) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return { ok: false, message: "Select a company as the source." }
    }
    const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
      supplierAccountId,
      note,
    })
    if (!resolved.ok) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return resolved
    }
    const { error: layerErr } = await addCostLayerWithSourcePackage(supabase, {
      packageId: id,
      sourcePackageId: id,
      quantity: qty,
      unitCost: cost,
      currency: input.currency.trim() || "USD",
      note,
      receivedAt: null,
      source: null,
      purchaseOrderId: resolved.id,
    })
    if (layerErr) {
      await supabase.from("package_inventory").delete().eq("package_id", id)
      await supabase.from("packages").delete().eq("id", id)
      return { ok: false, message: linkedDayCostErrorMessage(layerErr.message) }
    }
    try {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("supplier_id")
        .eq("id", resolved.id)
        .maybeSingle()
      await recordPurchaseLedgerForLatestLayer(supabase, id, qty, {
        purchaseOrderId: resolved.id,
        supplierId: (po as { supplier_id?: string | null } | null)?.supplier_id ?? null,
        reason: "Initial stock with purchase order",
      })
    } catch (e) {
      console.warn(
        "[createPackage] ledger append skipped:",
        e instanceof Error ? e.message : e,
      )
    }
    revalidatePath("/admin/purchase-orders")
  }

  // Native mode: shared physical pool + day consumption instead of Salesforce shells.
  if (isNativePlatformMode() && inventoryGroupId) {
    try {
      await supabase.rpc("admin_ensure_inventory_pool_for_group", {
        p_inventory_group_id: inventoryGroupId,
      })
      await supabase.rpc("seed_package_day_consumption", { p_package_id: id })
    } catch (e) {
      console.warn(
        "[createPackage] Native inventory pool was not ensured:",
        e instanceof Error ? e.message : e,
      )
    }
  }

  // Legacy mode only: 3-day parents need three Single Ticket children in Salesforce.
  // Native mode leaves existing shells untouched and creates no new ones.
  if (!isNativePlatformMode() && duration === "3_day") {
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

  const DAY_DURATIONS_FOR_CREATE = ["thursday_only", "friday_only", "saturday_only", "sunday_only", "2_day"] as const
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

  const { error } = await gate.supabase.rpc("admin_reassign_order_package_stock", {
    p_order_id: orderId,
    p_package_id: packageId,
    p_allocations: allocations,
  })
  if (error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes("allocation_total_must_equal_order_guests") ||
      msg.includes("allocation_total_must_equal_line_quantity")
    ) {
      return { ok: false, message: "Supplier quantities must add up to the order guest count." }
    }
    if (
      msg.includes("insufficient_layer_remaining") ||
      msg.includes("insufficient_purchased_day_capacity")
    ) {
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

/** Salesforce inventory pull is retired. Kept so old admin buttons fail safely. */
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
  return { ok: false, message: "Salesforce runtime has been retired." }
}

/**
 * Import Salesforce Stock Sources into portal purchase lines for one package.
 * Salesforce runtime is retired — this action is a no-op.
 */
export async function importPackageStockSourcesFromSalesforce(
  packageId: string,
): Promise<ActionResult & { imported?: number }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  void packageId
  return { ok: false, message: "Salesforce runtime has been retired." }
}

function autoPurchaseOrderNumber(): string {
  return generatePurchaseOrderNumber()
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
    supplierAccountId: string
    poNumber?: string | null
    issuedAt?: string | null
    note?: string | null
  },
): Promise<{ ok: true; id: string; linkedExisting: boolean } | { ok: false; message: string }> {
  const ensured = await ensureSupplierForAccount(supabase, input.supplierAccountId)
  if (!ensured.ok) return ensured
  const supplier = ensured.name

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
    const linked = await linkPurchaseOrderToAccount(supabase, String(existing.id), input.supplierAccountId)
    if (!linked.ok) return linked
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

  const poId = String(data)
  const linked = await linkPurchaseOrderToAccount(supabase, poId, input.supplierAccountId)
  if (!linked.ok) return linked
  return { ok: true, id: poId, linkedExisting: false }
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

export async function saveInventoryGroupCostPolicy(input: {
  inventoryGroupId: string
  sourcePackageId?: string
  mode: "derived" | "manual"
  percentages?: Partial<Record<CostDaySlot, string | number>>
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  const inventoryGroupId = input.inventoryGroupId.trim()
  if (!inventoryGroupId) return { ok: false, message: "Linked inventory group is missing." }

  const { data: packageData, error: packageError } = await gate.supabase
    .from("packages")
    .select("id,duration,event_date,trade_price")
    .eq("inventory_group_id", inventoryGroupId)
    .is("shell_parent_package_id", null)
  if (packageError) return { ok: false, message: packageError.message }
  const packages = (packageData ?? []) as Array<{
    id: string
    duration: string | null
    event_date: string | null
    trade_price: number | string | null
  }>
  const requestedSource = input.sourcePackageId?.trim()
  const source =
    packages.find(
      (pkg) =>
        pkg.id === requestedSource &&
        (pkg.duration === "3_day" || pkg.duration === "2_day"),
    ) ??
    packages.find((pkg) => pkg.duration === "3_day") ??
    packages.find((pkg) => pkg.duration === "2_day")
  if (!source) {
    return { ok: false, message: "This group needs a 2-day or 3-day source package." }
  }

  const days = costDaySlotsForDuration(source.duration, source.event_date)
  let manualWeights: Partial<Record<CostDaySlot, number>> | null = null
  if (input.mode === "manual") {
    const validation = validateManualDayPercentages(days, input.percentages ?? {})
    if (!validation.ok) return { ok: false, message: validation.message }
    manualWeights = Object.fromEntries(
      days.map((day) => [day, validation.weights[day]]),
    ) as Partial<Record<CostDaySlot, number>>
  } else {
    const derived = deriveTradePriceDayWeights({
      sourceDuration: source.duration,
      eventDate: source.event_date,
      members: packages.map((pkg) => ({
        packageId: pkg.id,
        duration: pkg.duration,
        tradePrice: pkg.trade_price == null ? null : Number(pkg.trade_price),
      })),
    })
    if (derived.status === "setup_required") {
      return {
        ok: false,
        message: `Add a positive trade price for ${derived.missingDays.map(dayLabel).join(" and ")}, or use manual percentages totaling exactly 100%.`,
      }
    }
  }

  const rpcManualWeights =
    manualWeights == null
      ? null
      : Object.fromEntries(
          Object.entries(manualWeights).map(([day, weight]) => [
            day.replace(/_only$/, ""),
            weight,
          ]),
        )
  const allocationMethod =
    input.mode === "derived" ? "normalized_trade_price" : "manual"
  const primary = await gate.supabase.rpc("admin_set_inventory_group_cost_policy", {
    p_inventory_group_id: inventoryGroupId,
    p_allocation_method: allocationMethod,
    p_manual_weights: rpcManualWeights,
  })
  let policyError = primary.error
  if (isMissingRpcSignature(policyError)) {
    const alternate = await gate.supabase.rpc("admin_set_inventory_group_cost_policy", {
      p_inventory_group_id: inventoryGroupId,
      p_mode: input.mode,
      p_manual_weights: rpcManualWeights,
    })
    policyError = alternate.error
  }
  if (isMissingRpcSignature(policyError)) {
    const legacyAlternate = await gate.supabase.rpc("admin_set_inventory_group_cost_policy", {
      p_group_id: inventoryGroupId,
      p_policy_mode: input.mode,
      p_weights: rpcManualWeights,
    })
    policyError = legacyAlternate.error
  }
  if (isMissingRpcSignature(policyError)) {
    return {
      ok: false,
      message: "Day cost policy saving is unavailable until the linked-day costing database migration is deployed.",
    }
  }
  if (policyError) {
    return { ok: false, message: linkedDayCostErrorMessage(policyError.message) }
  }

  revalidatePath("/admin/catalog")
  for (const pkg of packages) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(pkg.id)}`)
  }
  return {
    ok: true,
    message:
      input.mode === "manual"
        ? "Manual day cost percentages saved for future purchases."
        : "Day cost percentages will be derived from current trade prices for future purchases.",
  }
}

/** Add stock and create (or link) the purchase order in one step. Optional contract upload. */
export async function addStockPurchaseLayer(formData: FormData): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const packageId = String(formData.get("packageId") ?? "").trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const supplierAccountId = String(formData.get("supplierAccountId") ?? "").trim()
  if (!supplierAccountId) return { ok: false, message: "Select a company as the supplier." }

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
  const target = await remapToLinkedStockLedger(supabase, packageId, fulfilmentBlockId)

  const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
    supplierAccountId,
    poNumber: poNumberRaw || null,
    issuedAt: poIssuedAt,
    note,
  })
  if (!resolved.ok) return resolved

  const { error } = await addCostLayerWithSourcePackage(supabase, {
    packageId: target.packageId,
    sourcePackageId: packageId,
    quantity: q,
    unitCost: c,
    currency: null,
    note,
    receivedAt: received,
    source: null,
    purchaseOrderId: resolved.id,
    fulfilmentBlockId: target.fulfilmentBlockId,
  })
  if (error) {
    if (!resolved.linkedExisting) {
      const { error: cleanupError } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("id", resolved.id)
      if (cleanupError) {
        console.warn(
          "[addStockPurchaseLayer] failed to remove unused purchase order:",
          cleanupError.message,
        )
      }
    }
    const m = error.message.toLowerCase()
    if (m.includes("fulfilment_block_wrong_package")) {
      return { ok: false, message: "Fulfilment block does not belong to this package." }
    }
    if (m.includes("fulfilment_block_not_found")) {
      return { ok: false, message: "Fulfilment block not found." }
    }
    return { ok: false, message: linkedDayCostErrorMessage(error.message) }
  }

  const rawFile = formData.get("file")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (file) {
    const upload = await uploadPurchaseOrderDocumentFromFile(gate, resolved.id, file)
    if (!upload.ok) return upload
  }

  revalidateAdminProfitPaths(target.packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/packages")
  revalidatePath("/")

  const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
    p_package_id: target.packageId,
  })
  if (bfErr) return { ok: false, message: bfErr.message }
  await reconcileInventoryAfterCostLayerChange(supabase, target.packageId)

  try {
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("supplier_id")
      .eq("id", resolved.id)
      .maybeSingle()
    await recordPurchaseLedgerForLatestLayer(supabase, packageId, q, {
      purchaseOrderId: resolved.id,
      supplierId: (po as { supplier_id?: string | null } | null)?.supplier_id ?? null,
      reason: "Stock purchase with purchase order",
    })
  } catch (e) {
    console.warn(
      "[addStockPurchaseLayer] ledger append skipped:",
      e instanceof Error ? e.message : e,
    )
  }

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
  const target = await remapToLinkedStockLedger(supabase, input.packageId, fulfilmentBlockId)
  const { error } = await addCostLayerWithSourcePackage(supabase, {
    packageId: target.packageId,
    sourcePackageId: input.packageId,
    quantity: q,
    unitCost: c,
    currency: input.currency?.trim() || null,
    note: input.note ?? null,
    receivedAt: received,
    source: input.source?.trim() || null,
    purchaseOrderId,
    fulfilmentBlockId: target.fulfilmentBlockId,
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
    return { ok: false, message: linkedDayCostErrorMessage(error.message) }
  }

  try {
    await recordPurchaseLedgerForLatestLayer(supabase, target.packageId, q, {
      purchaseOrderId,
      reason: "Stock purchase cost layer",
    })
  } catch (e) {
    console.warn("[addCostLayer] ledger append skipped:", e instanceof Error ? e.message : e)
  }

  revalidateAdminProfitPaths(target.packageId)
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
  revalidatePath("/packages")
  revalidatePath("/")
  const { error: bfErr } = await supabase.rpc("admin_backfill_package_order_costs", {
    p_package_id: target.packageId,
  })
  if (bfErr) return { ok: false, message: bfErr.message }
  await enqueueLinkedInventoryChannelSync(supabase, target.packageId)
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
  /** Create or update the linked purchase order (company always required when set). */
  purchaseOrderSupplierAccountId?: string | null
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
    input.purchaseOrderSupplierAccountId !== undefined ||
    input.purchaseOrderNumber !== undefined ||
    input.purchaseOrderIssuedAt !== undefined

  if (purchaseFieldsProvided) {
    const supplierAccountId = input.purchaseOrderSupplierAccountId?.trim() ?? ""
    if (!supplierAccountId) {
      return { ok: false, message: "Select a company as the supplier." }
    }

    const ensured = await ensureSupplierForAccount(supabase, supplierAccountId)
    if (!ensured.ok) return ensured

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
        p_supplier: ensured.name,
        p_issued_at: input.purchaseOrderIssuedAt?.trim() || null,
        p_note: null,
        p_clear_issued_at: !input.purchaseOrderIssuedAt?.trim(),
      })
      if (poUpdErr) return { ok: false, message: poUpdErr.message }
      const linked = await linkPurchaseOrderToAccount(supabase, existingPoId, supplierAccountId)
      if (!linked.ok) return linked
    } else {
      const resolved = await resolveOrCreatePurchaseOrderId(supabase, {
        supplierAccountId,
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
  revalidatePath("/admin/purchase-orders")
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
    .select("package_id, purchase_order_id")
    .eq("id", layerId.trim())
    .maybeSingle()
  const purchaseOrderId =
    typeof layer?.purchase_order_id === "string" ? layer.purchase_order_id : null
  const { data: docs } = purchaseOrderId
    ? await supabase
        .from("purchase_order_documents")
        .select("file_path")
        .eq("purchase_order_id", purchaseOrderId)
    : { data: [] }
  const { error } = await supabase.rpc("admin_delete_cost_layer_and_empty_purchase_order", {
    p_layer_id: layerId.trim(),
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (
      message.includes("layer_has_active_allocations") ||
      message.includes("layer_already_consumed")
    ) {
      return {
        ok: false,
        message: "Cannot delete this stock purchase because it still fulfils an active sale.",
      }
    }
    return { ok: false, message: error.message }
  }
  if (purchaseOrderId) {
    const { data: remainingPurchaseOrder } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("id", purchaseOrderId)
      .maybeSingle()
    if (!remainingPurchaseOrder) {
      const paths = (docs ?? [])
        .map((document) => String((document as { file_path?: string }).file_path ?? "").trim())
        .filter(Boolean)
      if (paths.length > 0) {
        const admin = createAdminClient()
        if (admin) await admin.storage.from(PO_DOCUMENT_BUCKET).remove(paths)
      }
    }
  }
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/purchase-orders")
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
    supplierAccountId: string
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
    const supplierAccountId = convert.supplierAccountId.trim()
    if (!supplierAccountId) return { ok: false, message: "Select a company as the supplier." }
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
      supplierAccountId,
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

    const { error: addErr } = await addCostLayerWithSourcePackage(supabase, {
      packageId,
      sourcePackageId: packageId,
      quantity: newQty,
      unitCost,
      currency: null,
      note: convert.note?.trim() || "Converted from untracked stock",
      receivedAt: received,
      source: null,
      purchaseOrderId: resolved.id,
      fulfilmentBlockId,
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
      return { ok: false, message: linkedDayCostErrorMessage(addErr.message) }
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

  if (isNativePlatformMode()) {
    return {
      ok: false,
      message:
        "Native platform mode does not create Salesforce shell single tickets. Existing shell rows are left untouched.",
    }
  }

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
export async function relinkPackageToSalesforceProduct(input: {
  packageId: string
  salesforceProductId: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate
  void input
  return { ok: false, message: "Salesforce runtime has been retired." }
}

// ============================================================================
// Purchase Orders + Fulfilment Blocks
// ============================================================================

type PurchaseOrderIdResult = { ok: true; id: string } | { ok: false; message: string }

function parsePurchaseOrderLines(
  lines: Array<{ packageId: string; quantity: number; unitCost: number }> | undefined,
):
  | { ok: true; lines: Array<{ packageId: string; quantity: number; unitCost: number }> }
  | { ok: false; message: string } {
  const parsed: Array<{ packageId: string; quantity: number; unitCost: number }> = []
  for (const line of lines ?? []) {
    const packageId = line.packageId.trim()
    if (!packageId) continue
    const quantity = Math.floor(Number(line.quantity))
    const unitCost = Number(line.unitCost)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, message: "Each product needs a positive whole-number quantity." }
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return { ok: false, message: "Each product needs a non-negative buy price." }
    }
    parsed.push({ packageId, quantity, unitCost })
  }
  if (parsed.length === 0) {
    return { ok: false, message: "Add at least one product with quantity and buy price." }
  }
  return { ok: true, lines: parsed }
}

export async function createPurchaseOrder(input: {
  poNumber?: string | null
  supplierAccountId: string
  supplierReference?: string | null
  issuedAt?: string | null
  note?: string | null
  lines?: Array<{ packageId: string; quantity: number; unitCost: number }>
}): Promise<PurchaseOrderIdResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const poNumber = input.poNumber?.trim() || generatePurchaseOrderNumber()
  if (poNumber.length > 200) return { ok: false, message: "Internal PO number must be 200 characters or fewer." }

  const lines = parsePurchaseOrderLines(input.lines)
  if (!lines.ok) return lines

  const ensured = await ensureSupplierForAccount(gate.supabase, input.supplierAccountId)
  if (!ensured.ok) return ensured
  const supplier = ensured.name

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
  const id = String(data)
  const linked = await linkPurchaseOrderToAccount(gate.supabase, id, input.supplierAccountId)
  if (!linked.ok) return linked
  const referenced = await setPurchaseOrderSupplierReference(
    gate.supabase,
    id,
    input.supplierReference,
  )
  if (!referenced.ok) return referenced

  const stockLines = new Map<
    string,
    { packageId: string; sourcePackageId: string; quantity: number; unitCost: number }
  >()
  for (const line of lines.lines) {
    const target = await remapToLinkedStockLedger(gate.supabase, line.packageId)
    const key = `${target.packageId}\u0000${line.packageId}`
    const existing = stockLines.get(key)
    if (existing) {
      const totalQty = existing.quantity + line.quantity
      existing.unitCost =
        totalQty > 0
          ? (existing.unitCost * existing.quantity + line.unitCost * line.quantity) / totalQty
          : line.unitCost
      existing.quantity = totalQty
      continue
    }
    stockLines.set(key, {
      packageId: target.packageId,
      sourcePackageId: line.packageId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })
  }

  for (const line of stockLines.values()) {
    const { error: layerErr } = await addCostLayerWithSourcePackage(gate.supabase, {
      packageId: line.packageId,
      sourcePackageId: line.sourcePackageId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      currency: null,
      note: null,
      receivedAt: issuedAt,
      source: supplier,
      purchaseOrderId: id,
      fulfilmentBlockId: null,
    })
    if (layerErr) {
      return {
        ok: false,
        message: `Purchase order created, but a product could not be added: ${linkedDayCostErrorMessage(layerErr.message)}`,
      }
    }
  }

  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  return { ok: true, id }
}

export async function updatePurchaseOrder(input: {
  id: string
  poNumber?: string | null
  supplierAccountId?: string | null
  supplierReference?: string | null
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

  const supplierAccountId = input.supplierAccountId?.trim() || null
  let supplierName: string | null = null
  if (supplierAccountId) {
    const ensured = await ensureSupplierForAccount(gate.supabase, supplierAccountId)
    if (!ensured.ok) return ensured
    supplierName = ensured.name
  }

  const { error } = await gate.supabase.rpc("admin_update_purchase_order", {
    p_id: id,
    p_po_number: input.poNumber?.trim() || null,
    p_supplier: supplierName,
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
  if (supplierAccountId) {
    const linked = await linkPurchaseOrderToAccount(gate.supabase, id, supplierAccountId)
    if (!linked.ok) return linked
  }
  if (input.supplierReference !== undefined) {
    const referenced = await setPurchaseOrderSupplierReference(
      gate.supabase,
      id,
      input.supplierReference,
    )
    if (!referenced.ok) return referenced
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

  const { data: layers } = await gate.supabase
    .from("package_cost_layers")
    .select("id, package_id, quantity, quantity_remaining")
    .eq("purchase_order_id", id)

  // Best-effort: also delete stored attachment files.
  const { data: docs } = await gate.supabase
    .from("purchase_order_documents")
    .select("file_bucket, file_path")
    .eq("purchase_order_id", id)

  const { error } = await gate.supabase.rpc("admin_delete_purchase_order", { p_id: id })
  if (error) {
    const m = error.message.toLowerCase()
    if (
      m.includes("purchase_order_stock_sold") ||
      m.includes("layer_already_consumed") ||
      m.includes("layer_has_active_allocations")
    ) {
      return {
        ok: false,
        message: "Cannot delete this purchase order because some of its stock has already been sold.",
      }
    }
    if (m.includes("qty_held_would_exceed_capacity") || m.includes("would_drop_below_holds")) {
      return {
        ok: false,
        message: "Cannot delete this purchase order while units from it are on hold.",
      }
    }
    if (m.includes("purchase_order_in_use")) {
      return { ok: false, message: "Cannot delete: this PO is still linked to stock that cannot be removed." }
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

  const packageIds = [
    ...new Set(
      (layers ?? [])
        .map((row) => String((row as { package_id?: string }).package_id ?? "").trim())
        .filter(Boolean),
    ),
  ]
  for (const packageId of packageIds) {
    await reconcileInventoryAfterCostLayerChange(gate.supabase, packageId)
  }

  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  revalidatePath("/")
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

export async function listCrmCompanyOptions(): Promise<import("@/lib/crm/deals").CrmCompanyOption[]> {
  const gate = await requireAdminAction()
  if (!gate.ok) return []
  return getCrmCompanyOptions()
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

  const { ensurePurchaseOrdersForPackageLayers } = await import("@/lib/admin/purchase-orders")
  const [initialPkg, wixListings] = await Promise.all([
    getAdminPackageById(id),
    getWixChannelListingsForPackage(id),
  ])
  if (!initialPkg) return null

  let pkg = initialPkg
  if (pkg.cost_layers.some((layer) => !layer.purchase_order_id)) {
    const created = await ensurePurchaseOrdersForPackageLayers(id)
    if (created > 0) {
      const refreshed = await getAdminPackageById(id)
      if (refreshed) pkg = refreshed
    }
  }

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

// ---------------------------------------------------------------------------
// Phase 1B — native inventory foundation actions
// ---------------------------------------------------------------------------

export async function setPackageOpeningBalance(input: {
  packageId: string
  verifiedQty: number
  reason?: string
}): Promise<ActionResult> {
  const gate = await requireAdminAction("inventory.adjust")
  if (!gate.ok) return gate

  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const qty = Math.floor(Number(input.verifiedQty))
  if (!Number.isFinite(qty) || qty < 0) {
    return { ok: false, message: "Verified quantity must be a non-negative whole number." }
  }

  const reason = input.reason?.trim() || "Opening balance reset"
  const { error } = await gate.supabase.rpc("admin_set_opening_balance", {
    p_package_id: packageId,
    p_verified_qty: qty,
    p_reason: reason,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("canonical_stock_adjustment_requires_purchase_layer")) {
      return {
        ok: false,
        message:
          "Record the verified stock as a supplier purchase so quantity, day capacity, and cost remain auditable.",
      }
    }
    if (m.includes("opening_balance_below_held")) {
      return {
        ok: false,
        message: "Verified quantity cannot be below units currently on hold.",
      }
    }
    return { ok: false, message: error.message }
  }

  await enqueuePackageInventoryChannelSync(gate.supabase, packageId)
  revalidateAdminProfitPaths(packageId)
  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  revalidatePath("/admin/inventory")
  revalidatePath("/packages")
  return { ok: true, message: `Opening balance set to ${qty}.` }
}

export async function adjustPackageStockWithReason(input: {
  packageId: string
  delta: number
  reason: string
}): Promise<ActionResult> {
  const gate = await requireAdminAction("inventory.adjust")
  if (!gate.ok) return gate

  const packageId = input.packageId.trim()
  if (!packageId) return { ok: false, message: "Package id is missing." }

  const delta = Math.floor(Number(input.delta))
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, message: "Adjustment must be a non-zero whole number." }
  }

  const reason = input.reason.trim()
  if (!reason) return { ok: false, message: "A reason is required for stock adjustments." }

  const { error } = await gate.supabase.rpc("admin_adjust_stock_with_reason", {
    p_package_id: packageId,
    p_delta: delta,
    p_reason: reason,
  })
  if (error) {
    const m = error.message.toLowerCase()
    if (m.includes("canonical_stock_adjustment_requires_purchase_layer")) {
      return {
        ok: false,
        message:
          "Adjust the relevant supplier purchase instead so quantity, day capacity, and cost remain aligned.",
      }
    }
    if (m.includes("adjustment_below_held")) {
      return { ok: false, message: "Adjustment would leave available stock below held units." }
    }
    if (m.includes("adjustment_below_zero")) {
      return { ok: false, message: "Adjustment would make available stock negative." }
    }
    return { ok: false, message: error.message }
  }

  await enqueuePackageInventoryChannelSync(gate.supabase, packageId)
  revalidateAdminProfitPaths(packageId)
  revalidatePath("/admin/catalog")
  revalidatePath(`/admin/catalog/${encodeURIComponent(packageId)}`)
  revalidatePath("/admin/inventory")
  return {
    ok: true,
    message: `Stock adjusted by ${delta > 0 ? "+" : ""}${delta}.`,
  }
}

export async function ensureInventoryPoolForPackageGroup(input: {
  inventoryGroupId: string
}): Promise<ActionResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const groupId = input.inventoryGroupId.trim()
  if (!groupId) return { ok: false, message: "Inventory group id is missing." }

  const { data, error } = await gate.supabase.rpc("admin_ensure_inventory_pool_for_group", {
    p_inventory_group_id: groupId,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath("/admin/catalog")
  return {
    ok: true,
    message: `Inventory pool ready (${String(data)}).`,
  }
}

export async function ensureSupplier(input: {
  name: string
  code?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  notes?: string | null
}): Promise<ActionResult & { supplierId?: string }> {
  const gate = await requireAdminAction()
  if (!gate.ok) return gate

  const name = input.name.trim()
  if (!name) return { ok: false, message: "Supplier name is required." }

  const { data, error } = await gate.supabase.rpc("admin_ensure_supplier", {
    p_name: name,
    p_code: input.code?.trim() || null,
    p_contact_name: input.contactName?.trim() || null,
    p_contact_email: input.contactEmail?.trim() || null,
    p_contact_phone: input.contactPhone?.trim() || null,
    p_notes: input.notes?.trim() || null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath("/admin/purchase-orders")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/suppliers")
  revalidatePath("/admin/leads")
  return { ok: true, message: "Supplier saved.", supplierId: String(data) }
}

export type NativeEventInput = {
  category: EventCategory
  name: string
  shortName: string
  location: string
  country: string
  countryCode: string
  eventDate: string
  dateRange: string
  image: string
  season: number
}

function nativeEventId(name: string, season: number): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
  return `${slug}-${season}`
}

function validateNativeEvent(input: NativeEventInput):
  | { ok: true; value: NativeEventInput }
  | { ok: false; message: string } {
  const name = input.name.trim()
  const category = input.category
  const shortName = input.shortName.trim()
  const location = input.location.trim()
  const country = input.country.trim()
  const countryCode = input.countryCode.trim().toUpperCase().slice(0, 8)
  const eventDate = input.eventDate.trim()
  const dateRange = input.dateRange.trim()
  if (/chatgpt\.com|oaidalle/i.test(input.image)) {
    return { ok: false, message: "ChatGPT image links expire and cannot be saved. Upload the image file instead." }
  }
  const image = sanitizeHttpsUrl(input.image) ?? "/placeholder.svg"
  const season = Math.floor(Number(input.season))

  if (!isEventCategory(category)) return { ok: false, message: "Select a valid event category." }
  if (!name || !shortName) return { ok: false, message: "Event name and short name are required." }
  if (!location || !country || !countryCode) {
    return { ok: false, message: "Location, country and country code are required." }
  }
  if (!eventDate || Number.isNaN(new Date(`${eventDate}T00:00:00Z`).getTime())) {
    return { ok: false, message: "A valid event date is required." }
  }
  if (!dateRange) return { ok: false, message: "Date range is required." }
  if (!Number.isFinite(season) || season < 2020 || season > 2100) {
    return { ok: false, message: "Season must be a valid four-digit year." }
  }

  return {
    ok: true,
    value: { category, name, shortName, location, country, countryCode, eventDate, dateRange, image, season },
  }
}

function revalidateNativeEventPaths(): void {
  revalidatePath("/admin/catalog/events")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath("/packages")
  revalidatePath("/")
}

export async function createNativeEvent(
  input: NativeEventInput,
): Promise<ActionResult & { eventId?: string }> {
  const gate = await requireAdminAction("inventory.manage")
  if (!gate.ok) return gate

  const checked = validateNativeEvent(input)
  if (!checked.ok) return checked
  const value = checked.value
  const id = nativeEventId(value.name, value.season)
  if (!id || id.length < 3) return { ok: false, message: "Could not generate a valid event ID." }

  const { data: existing } = await gate.supabase.from("races").select("id").eq("id", id).maybeSingle()
  if (existing) return { ok: false, message: "An event with this name and season already exists." }

  const { error } = await gate.supabase.from("races").insert({
    id,
    category: value.category,
    name: value.name,
    short_name: value.shortName,
    location: value.location,
    country: value.country,
    country_code: value.countryCode,
    event_date: value.eventDate,
    date_range: value.dateRange,
    image: value.image,
    season: value.season,
    is_archived: false,
    updated_at: new Date().toISOString(),
  })
  if (error) return { ok: false, message: error.message }

  revalidateNativeEventPaths()
  return { ok: true, message: "Event created.", eventId: id }
}

export async function updateNativeEvent(
  raceId: string,
  input: NativeEventInput,
): Promise<ActionResult> {
  const gate = await requireAdminAction("inventory.manage")
  if (!gate.ok) return gate
  const id = raceId.trim()
  if (!id) return { ok: false, message: "Event ID is missing." }

  const checked = validateNativeEvent(input)
  if (!checked.ok) return checked
  const value = checked.value
  const { error } = await gate.supabase
    .from("races")
    .update({
      category: value.category,
      name: value.name,
      short_name: value.shortName,
      location: value.location,
      country: value.country,
      country_code: value.countryCode,
      event_date: value.eventDate,
      date_range: value.dateRange,
      image: value.image,
      season: value.season,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) return { ok: false, message: error.message }

  revalidateNativeEventPaths()
  return { ok: true, message: "Event updated." }
}

export async function setNativeEventArchived(
  raceId: string,
  archived: boolean,
): Promise<ActionResult> {
  const gate = await requireAdminAction("inventory.archive")
  if (!gate.ok) return gate
  const id = raceId.trim()
  if (!id) return { ok: false, message: "Event ID is missing." }

  const { error } = await gate.supabase.rpc("admin_set_event_archived", {
    p_race_id: id,
    p_archived: archived,
  })
  if (error) return { ok: false, message: error.message }

  revalidateNativeEventPaths()
  return {
    ok: true,
    message: archived
      ? "Event archived and its products hidden from sale."
      : "Event restored. Products remain hidden until reviewed and republished.",
  }
}

export async function createNativeDeal(input: {
  accountId?: string | null
  contactId?: string | null
  accountName?: string
  contactName?: string | null
  contactEmail?: string | null
  packageId?: string | null
  quantity?: number
  unitSalePrice?: number | null
  source?: string | null
  notes?: string | null
  reserve?: boolean
  lines?: Array<{
    packageId: string
    quantity: number
    unitPrice: number
    sourcingMode?: "owned" | "brokered"
    supplierId?: string | null
    expectedUnitCost?: number | null
    supplierQuoteAt?: string | null
  }>
}): Promise<ActionResult & { dealId?: string }> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate

  const accountId = input.accountId?.trim() || null
  const contactId = input.contactId?.trim() || null
  const accountName = input.accountName?.trim() || ""
  if (!accountId && !accountName) {
    return { ok: false, message: "Select an account / company." }
  }
  if (accountId && !UUID_RE.test(accountId)) {
    return { ok: false, message: "Selected account is not valid." }
  }
  if (contactId && !UUID_RE.test(contactId)) {
    return { ok: false, message: "Selected contact is not valid." }
  }
  if (contactId && !accountId) {
    return { ok: false, message: "A contact must belong to the selected account." }
  }

  const quantity = Math.floor(Number(input.quantity ?? 1))
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, message: "Quantity must be at least 1." }
  }

  let unitSalePrice: number | null = null
  if (input.unitSalePrice != null && String(input.unitSalePrice) !== "") {
    const price = Number(input.unitSalePrice)
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, message: "Sale price must be a non-negative number." }
    }
    unitSalePrice = price
  }

  const normalizedLines = input.lines?.map((line) => {
    const quoteAt = line.supplierQuoteAt?.trim()
    const quoteTime = quoteAt ? Date.parse(quoteAt) : Number.NaN
    return {
      packageId: line.packageId.trim(),
      quantity: Math.floor(Number(line.quantity)),
      unitPrice: Number(line.unitPrice),
      sourcingMode: line.sourcingMode ?? "owned",
      supplierId: line.supplierId?.trim() || null,
      expectedUnitCost:
        line.expectedUnitCost == null || String(line.expectedUnitCost) === ""
          ? null
          : Number(line.expectedUnitCost),
      supplierQuoteAt: quoteAt && Number.isFinite(quoteTime) ? new Date(quoteTime).toISOString() : null,
      invalidQuoteAt: Boolean(quoteAt) && !Number.isFinite(quoteTime),
    }
  })
  if (normalizedLines?.length) {
    if (!accountId) return { ok: false, message: "Select or create the CRM company first." }
    for (const line of normalizedLines) {
      if (
        !line.packageId ||
        !Number.isFinite(line.quantity) ||
        line.quantity < 1 ||
        !Number.isFinite(line.unitPrice) ||
        line.unitPrice < 0 ||
        line.invalidQuoteAt ||
        (line.expectedUnitCost != null &&
          (!Number.isFinite(line.expectedUnitCost) || line.expectedUnitCost < 0))
      ) {
        return { ok: false, message: "One or more deal product lines are incomplete." }
      }
      if (
        input.reserve &&
        line.sourcingMode === "brokered" &&
        (!line.supplierId || line.expectedUnitCost == null || !line.supplierQuoteAt)
      ) {
        return { ok: false, message: "Brokered products need a supplier, buy price and fresh quote time before holding stock." }
      }
    }
  }

  const sharedArgs = {
    p_package_id: input.packageId?.trim() || null,
    p_quantity: quantity,
    p_unit_sale_price: unitSalePrice,
    p_source: input.source?.trim() || "offline",
    p_stage: input.reserve ? "proposal" : "draft",
    p_notes: input.notes?.trim() || null,
    p_reserve: Boolean(input.reserve),
  }
  const { data, error } = normalizedLines?.length
    ? await gate.supabase.rpc("admin_create_deal_with_lines", {
        p_account_id: accountId,
        p_contact_id: contactId,
        p_source: input.source?.trim() || "offline",
        p_notes: input.notes?.trim() || null,
        p_lines: normalizedLines,
        p_reserve: Boolean(input.reserve),
        p_hold_days: 7,
      })
    : accountId
      ? await gate.supabase.rpc("admin_create_deal_with_existing_links", {
        p_account_id: accountId,
        p_contact_id: contactId,
        ...sharedArgs,
      })
      : await gate.supabase.rpc("admin_create_deal_with_line", {
        p_account_name: accountName,
        p_contact_name: input.contactName?.trim() || null,
        p_contact_email: input.contactEmail?.trim() || null,
        ...sharedArgs,
      })

  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("insufficient_stock")) {
      return { ok: false, message: "Not enough sellable stock to reserve for this deal." }
    }
    if (message.includes("package_not_found")) {
      return { ok: false, message: "Selected package was not found." }
    }
    if (message.includes("account_not_found")) {
      return { ok: false, message: "Selected account is no longer available." }
    }
    if (message.includes("contact_not_found_for_account")) {
      return { ok: false, message: "Selected contact does not belong to this account." }
    }
    if (message.includes("brokered_quote_required") || message.includes("brokered_quote_expired")) {
      return { ok: false, message: "Every brokered product needs a supplier quote received within the last 24 hours." }
    }
    if (message.includes("mixed_currency_deal")) {
      return { ok: false, message: "All products in one deal must use the same currency." }
    }
    return { ok: false, message: error.message }
  }

  const dealId = String(data)
  revalidatePath("/admin/deals")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath("/admin/catalog")
  if (input.packageId?.trim()) {
    revalidatePath(`/admin/catalog/${encodeURIComponent(input.packageId.trim())}`)
  }
  return {
    ok: true,
    message: input.reserve
      ? "Deal created and stock reserved for 7 days."
      : "Deal created as a draft.",
    dealId,
  }
}

const LEAD_SOURCES = new Set([
  "manual",
  "website",
  "portal",
  "referral",
  "marketing",
  "repeat_client",
  "other",
])

export async function createNativeLead(input: {
  accountId?: string | null
  contactId?: string | null
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  interest?: string | null
  raceId?: string | null
  packageId?: string | null
  quantity?: number
  estimatedValue?: number | null
  nextAction?: string | null
  nextActionDueAt?: string | null
  ownerProfileId?: string | null
  notes?: string | null
}): Promise<ActionResult & { leadId?: string }> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate

  const accountId = input.accountId?.trim() || null
  const contactId = input.contactId?.trim() || null
  const ownerProfileId = input.ownerProfileId?.trim() || null
  if (accountId && !UUID_RE.test(accountId)) {
    return { ok: false, message: "Selected account is not valid." }
  }
  if (contactId && !UUID_RE.test(contactId)) {
    return { ok: false, message: "Selected contact is not valid." }
  }
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) {
    return { ok: false, message: "Selected owner is not valid." }
  }
  if (!accountId && !input.companyName?.trim() && !input.contactName?.trim() && !input.email?.trim()) {
    return { ok: false, message: "Enter a company, contact name, or email." }
  }

  const source = input.source?.trim() || "manual"
  if (!LEAD_SOURCES.has(source)) {
    return { ok: false, message: "Selected lead source is not valid." }
  }

  const quantity = Math.floor(Number(input.quantity ?? 1))
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, message: "Quantity must be at least 1." }
  }

  let estimatedValue: number | null = null
  if (input.estimatedValue != null && String(input.estimatedValue) !== "") {
    estimatedValue = Number(input.estimatedValue)
    if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
      return { ok: false, message: "Estimated value must be a non-negative number." }
    }
  }

  let nextActionDueAt: string | null = null
  if (input.nextActionDueAt?.trim()) {
    const due = new Date(input.nextActionDueAt)
    if (Number.isNaN(due.getTime())) {
      return { ok: false, message: "Next-action date is not valid." }
    }
    nextActionDueAt = due.toISOString()
  }

  const { data, error } = await gate.supabase.rpc("admin_create_crm_lead", {
    p_account_id: accountId,
    p_contact_id: contactId,
    p_company_name: input.companyName?.trim() || null,
    p_contact_name: input.contactName?.trim() || null,
    p_email: input.email?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_source: source,
    p_interest: input.interest?.trim() || null,
    p_race_id: input.raceId?.trim() || null,
    p_package_id: input.packageId?.trim() || null,
    p_quantity: quantity,
    p_estimated_value: estimatedValue,
    p_next_action: input.nextAction?.trim() || null,
    p_next_action_due_at: nextActionDueAt,
    p_owner_profile_id: ownerProfileId,
    p_notes: input.notes?.trim() || null,
  })

  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("contact_not_found_for_account")) {
      return { ok: false, message: "Selected contact does not belong to this account." }
    }
    if (message.includes("account_not_found")) {
      return { ok: false, message: "Selected account is no longer available." }
    }
    if (message.includes("package_not_found")) {
      return { ok: false, message: "Selected product is no longer available." }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath("/admin/leads")
  return { ok: true, message: "Lead created.", leadId: String(data) }
}

export async function convertNativeLeadToDeal(
  leadId: string,
): Promise<ActionResult & { dealId?: string }> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const id = leadId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Lead id is not valid." }

  const { data, error } = await gate.supabase.rpc("admin_convert_crm_lead_to_deal", {
    p_lead_id: id,
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("lead_not_found")) {
      return { ok: false, message: "Lead was not found." }
    }
    if (message.includes("lead_closed")) {
      return { ok: false, message: "A closed or unqualified lead cannot be converted." }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath("/admin/leads")
  revalidatePath("/admin/deals")
  return { ok: true, message: "Lead converted to a deal.", dealId: String(data) }
}

export async function updateNativeLeadWorkflow(input: {
  leadId: string
  status: string
  nextAction?: string | null
  nextActionDueAt?: string | null
  ownerProfileId?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction("accounts.manage")
  if (!gate.ok) return gate
  const leadId = input.leadId.trim()
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Lead id is not valid." }
  const allowedStatuses = new Set(["new", "contacted", "price_sent", "unqualified", "closed"])
  if (!allowedStatuses.has(input.status)) {
    return { ok: false, message: "Selected lead status is not valid." }
  }
  const ownerProfileId = input.ownerProfileId?.trim() || null
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) {
    return { ok: false, message: "Selected owner is not valid." }
  }
  let nextActionDueAt: string | null = null
  if (input.nextActionDueAt?.trim()) {
    const due = new Date(input.nextActionDueAt)
    if (Number.isNaN(due.getTime())) {
      return { ok: false, message: "Next-action date is not valid." }
    }
    nextActionDueAt = due.toISOString()
  }

  const { error } = await gate.supabase.rpc("admin_update_crm_lead_workflow", {
    p_lead_id: leadId,
    p_status: input.status,
    p_next_action: input.nextAction?.trim() || null,
    p_next_action_due_at: nextActionDueAt,
    p_owner_profile_id: ownerProfileId,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath("/admin/leads")
  return { ok: true, message: "Lead updated." }
}

export async function applyCrmImportBatch(
  batchId: string,
): Promise<ActionResult & { applied?: number; skipped?: number; failed?: number }> {
  const gate = await requireAdminAction("settings.manage")
  if (!gate.ok) return gate
  const id = batchId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Import batch id is not valid." }

  const { data, error } = await gate.supabase.rpc("admin_apply_crm_import_batch", {
    p_batch_id: id,
  })
  if (error) return { ok: false, message: error.message }

  const result =
    data && typeof data === "object"
      ? (data as { applied?: number; skipped?: number; failed?: number })
      : {}
  revalidatePath("/admin/imports")
  revalidatePath("/admin/leads")
  revalidatePath("/admin/deals")
  return {
    ok: true,
    message:
      Number(result.failed ?? 0) > 0
        ? `Import applied with ${result.failed} failed row(s).`
        : `Import applied successfully. Stock was not changed.`,
    applied: Number(result.applied ?? 0),
    skipped: Number(result.skipped ?? 0),
    failed: Number(result.failed ?? 0),
  }
}

export async function deleteCrmImportBatch(batchId: string): Promise<ActionResult> {
  const gate = await requireAdminAction("settings.manage")
  if (!gate.ok) return gate
  const id = batchId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Import batch id is not valid." }

  const { data: batch, error: readError } = await gate.supabase
    .from("crm_import_batches")
    .select("status")
    .eq("id", id)
    .maybeSingle()
  if (readError) return { ok: false, message: readError.message }
  if (!batch) return { ok: false, message: "Import batch was not found." }
  if (batch.status !== "validated" && batch.status !== "failed") {
    return { ok: false, message: "Applied import history cannot be deleted." }
  }

  const { error } = await gate.supabase.from("crm_import_batches").delete().eq("id", id)
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/imports")
  return { ok: true, message: "Import batch deleted." }
}

const NATIVE_DEAL_STAGES = new Set([
  "draft",
  "sourcing",
  "proposal",
  "awaiting_booking_form_send",
  "booking_form_sent",
  "awaiting_client_signature",
  "awaiting_zk_signature",
  "signed",
  "awaiting_invoice",
  "awaiting_payment",
  "paid_confirmed",
  "in_fulfilment",
  "fulfilled",
  "closed_lost",
  "cancelled",
])

export async function updateNativeDealWorkflow(input: {
  dealId: string
  stage: string
  ownerProfileId?: string | null
  nextAction?: string | null
  nextActionDueAt?: string | null
  expectedCloseDate?: string | null
  lossReason?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const dealId = input.dealId.trim()
  if (!UUID_RE.test(dealId)) return { ok: false, message: "Deal id is not valid." }
  if (!NATIVE_DEAL_STAGES.has(input.stage)) {
    return { ok: false, message: "Selected deal stage is not valid." }
  }
  const stage = input.stage === "booking_form_sent" ? "awaiting_client_signature" : input.stage
  const ownerProfileId = input.ownerProfileId?.trim() || null
  if (ownerProfileId && !UUID_RE.test(ownerProfileId)) {
    return { ok: false, message: "Selected owner is not valid." }
  }

  let nextActionDueAt: string | null = null
  if (input.nextActionDueAt?.trim()) {
    const due = new Date(input.nextActionDueAt)
    if (Number.isNaN(due.getTime())) {
      return { ok: false, message: "Next-action date is not valid." }
    }
    nextActionDueAt = due.toISOString()
  }
  const expectedCloseDate = input.expectedCloseDate?.trim() || null
  if (expectedCloseDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedCloseDate)) {
    return { ok: false, message: "Expected close date is not valid." }
  }

  const { error } = await gate.supabase.rpc("admin_update_deal_workflow", {
    p_deal_id: dealId,
    p_stage: stage,
    p_owner_profile_id: ownerProfileId,
    p_next_action: input.nextAction?.trim() || null,
    p_next_action_due_at: nextActionDueAt,
    p_expected_close_date: expectedCloseDate,
    p_loss_reason: input.lossReason?.trim() || null,
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("invalid_stage")) {
      return { ok: false, message: "That stage is not valid." }
    }
    if (message.includes("loss_reason_required")) {
      return { ok: false, message: "Enter a reason before closing the deal as lost." }
    }
    if (
      message.includes("insufficient_purchased_stock") ||
      message.includes("allocation_incomplete")
    ) {
      return {
        ok: false,
        message: "This deal cannot be confirmed because there is not enough purchased stock.",
      }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath("/admin/deals", "layout")
  return { ok: true, message: "Deal workflow updated." }
}

export async function reserveNativeDealStock(
  dealId: string,
  holdDays = 7,
): Promise<ActionResult> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const id = dealId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Deal id is not valid." }
  const days = Math.floor(Number(holdDays))
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    return { ok: false, message: "Hold length must be between 1 and 90 days." }
  }

  const { data, error } = await gate.supabase.rpc("admin_reserve_deal_stock", {
    p_deal_id: id,
    p_hold_days: days,
    p_reason: "Deal stock reserved manually",
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("insufficient_stock")) {
      return { ok: false, message: "There is not enough available stock to reserve this deal." }
    }
    if (message.includes("no_unreserved_lines")) {
      return { ok: false, message: "All deal lines are already reserved." }
    }
    if (message.includes("inventory_missing")) {
      return { ok: false, message: "Inventory is not configured for one of the deal products." }
    }
    return { ok: false, message: error.message }
  }
  const { data: lines } = await gate.supabase
    .from("deal_line_items")
    .select("package_id")
    .eq("deal_id", id)
  for (const packageId of new Set((lines ?? []).map((line) => line.package_id))) {
    await enqueueLinkedInventoryChannelSync(gate.supabase, packageId)
  }
  revalidatePath("/admin/deals")
  revalidatePath("/admin/inventory/sales-list")
  return { ok: true, message: `${Number(data ?? 0)} deal line(s) reserved.` }
}

export async function releaseNativeDealStock(dealId: string): Promise<ActionResult> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const id = dealId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Deal id is not valid." }
  const { data, error } = await gate.supabase.rpc("admin_release_deal_reservations", {
    p_deal_id: id,
    p_release_status: "released",
    p_reason: "Deal stock released manually",
  })
  if (error) return { ok: false, message: error.message }
  const { data: lines } = await gate.supabase
    .from("deal_line_items")
    .select("package_id")
    .eq("deal_id", id)
  for (const packageId of new Set((lines ?? []).map((line) => line.package_id))) {
    await enqueueLinkedInventoryChannelSync(gate.supabase, packageId)
  }
  revalidatePath("/admin/deals")
  revalidatePath("/admin/inventory/sales-list")
  return {
    ok: true,
    message:
      Number(data ?? 0) > 0
        ? `${Number(data)} reservation(s) released.`
        : "No active reservations required release.",
  }
}

export async function setNativeDealHoldPolicy(input: {
  dealId: string
  doNotExpire: boolean
  holdUntil?: string | null
}): Promise<ActionResult> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const dealId = input.dealId.trim()
  if (!UUID_RE.test(dealId)) return { ok: false, message: "Deal id is not valid." }

  let holdUntil: string | null = null
  if (!input.doNotExpire && input.holdUntil?.trim()) {
    const parsed = new Date(input.holdUntil)
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return { ok: false, message: "Hold expiry must be a future date." }
    }
    holdUntil = parsed.toISOString()
  }
  const { error } = await gate.supabase.rpc("admin_set_deal_hold_policy", {
    p_deal_id: dealId,
    p_do_not_expire: Boolean(input.doNotExpire),
    p_hold_until: holdUntil,
    p_reason: input.doNotExpire
      ? "Deal hold set not to expire"
      : "Deal hold expiry updated",
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath("/admin/deals")
  return { ok: true, message: "Hold policy updated." }
}

