"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"

type Result = { ok: true; message: string } | { ok: false; message: string }

export async function updateDealCommercials(input: {
  dealId: string
  accountId: string
  contactId?: string
  source: string
  notes?: string
  lines: Array<{
    id?: string
    packageId: string
    quantity: number
    unitPrice: number
    expectedUnitCost?: number | null
    sourcingMode?: "owned" | "brokered"
    supplierId?: string | null
    supplierQuoteAt?: string | null
  }>
}): Promise<Result> {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "Sales permission is required." }
  }
  if (!input.accountId || input.lines.length === 0) {
    return { ok: false, message: "Select an account and at least one product." }
  }
  for (const line of input.lines) {
    if (
      !line.packageId ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isFinite(line.unitPrice) ||
      line.unitPrice < 0 ||
      (line.expectedUnitCost != null &&
        (!Number.isFinite(line.expectedUnitCost) || line.expectedUnitCost < 0))
    ) {
      return { ok: false, message: "Check the quantity, sale price and expected cost on every line." }
    }
  }
  const { error } = await supabase.rpc("admin_update_deal_commercials", {
    p_deal_id: input.dealId,
    p_account_id: input.accountId,
    p_contact_id: input.contactId || null,
    p_source: input.source,
    p_notes: input.notes?.trim() || null,
    p_lines: input.lines.map((line) => ({
      id: line.id || null,
      packageId: line.packageId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      expectedUnitCost: line.expectedUnitCost ?? null,
      sourcingMode: line.sourcingMode ?? "owned",
      supplierId: line.supplierId || null,
      supplierQuoteAt: line.supplierQuoteAt
        ? new Date(line.supplierQuoteAt).toISOString()
        : null,
    })),
  })
  if (error) {
    const detail = error.message.toLowerCase()
    if (detail.includes("active_reservations_must_be_released")) {
      return { ok: false, message: "Release this deal's stock reservation before editing its products." }
    }
    if (detail.includes("booking_form_snapshot_locks_deal_lines")) {
      return { ok: false, message: "Products cannot be changed after a booking form has been sent." }
    }
    if (detail.includes("deal_with_order_is_locked")) {
      return { ok: false, message: "Products cannot be changed after an order has been created." }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/sales-tracker")
  revalidatePath("/admin")
  return { ok: true, message: "Deal details updated." }
}

const ACCOUNT_TYPES = new Set(["agent_company", "direct_client", "supplier_related", "other"])

function blank(value?: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed || null
}

export async function updateDealClientDetails(input: {
  dealId: string
  accountName?: string
  accountType?: string
  accountEmail?: string
  accountPhone?: string
  accountBilling?: {
    line1?: string
    line2?: string
    city?: string
    postcode?: string
    country?: string
  }
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  contactJobTitle?: string
  clientName?: string
  clientEmail?: string
  clientPhone?: string
  nationality?: string
  dietaryRequirements?: string
  specialRequests?: string
  shipping?: {
    line1?: string
    line2?: string
    city?: string
    postcode?: string
    country?: string
  }
  orderBilling?: {
    line1?: string
    line2?: string
    city?: string
    postcode?: string
    country?: string
  }
}): Promise<Result> {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "Sales permission is required." }
  }
  const dealId = input.dealId.trim()
  if (!dealId) return { ok: false, message: "Deal id is not valid." }

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, account_id, primary_contact_id, order_id")
    .eq("id", dealId)
    .maybeSingle()
  if (dealError || !deal) return { ok: false, message: "Deal was not found." }

  if (deal.account_id) {
    const accountName = blank(input.accountName)
    if (!accountName) return { ok: false, message: "Account name is required." }
    const accountType = blank(input.accountType) ?? "agent_company"
    if (!ACCOUNT_TYPES.has(accountType)) {
      return { ok: false, message: "Account type is not valid." }
    }
    const { error } = await supabase
      .from("crm_accounts")
      .update({
        name: accountName,
        account_type: accountType,
        email: blank(input.accountEmail),
        phone: blank(input.accountPhone),
        billing_address_line1: blank(input.accountBilling?.line1),
        billing_address_line2: blank(input.accountBilling?.line2),
        billing_city: blank(input.accountBilling?.city),
        billing_postcode: blank(input.accountBilling?.postcode),
        billing_country: blank(input.accountBilling?.country),
        updated_at: new Date().toISOString(),
      })
      .eq("id", deal.account_id)
    if (error) {
      if (error.message.toLowerCase().includes("crm_accounts_name_unique")) {
        return { ok: false, message: "Another account already uses that company name." }
      }
      return { ok: false, message: error.message }
    }
  }

  if (deal.primary_contact_id) {
    const contactName = blank(input.contactName)
    if (!contactName) return { ok: false, message: "Contact name is required." }
    const { error } = await supabase
      .from("crm_contacts")
      .update({
        full_name: contactName,
        email: blank(input.contactEmail),
        phone: blank(input.contactPhone),
        job_title: blank(input.contactJobTitle),
        updated_at: new Date().toISOString(),
      })
      .eq("id", deal.primary_contact_id)
    if (error) return { ok: false, message: error.message }
  }

  const fulfilment = {
    clientName: blank(input.clientName),
    clientEmail: blank(input.clientEmail),
    clientPhone: blank(input.clientPhone),
    nationality: blank(input.nationality),
    dietaryRequirements: blank(input.dietaryRequirements),
    specialRequests: blank(input.specialRequests),
    shippingLine1: blank(input.shipping?.line1),
    shippingLine2: blank(input.shipping?.line2),
    shippingCity: blank(input.shipping?.city),
    shippingPostcode: blank(input.shipping?.postcode),
    shippingCountry: blank(input.shipping?.country),
    billingLine1: blank(input.orderBilling?.line1),
    billingLine2: blank(input.orderBilling?.line2),
    billingCity: blank(input.orderBilling?.city),
    billingPostcode: blank(input.orderBilling?.postcode),
    billingCountry: blank(input.orderBilling?.country),
  }

  if (deal.order_id) {
    const { error } = await supabase
      .from("orders")
      .update({
        client_name: fulfilment.clientName ?? "",
        client_email: fulfilment.clientEmail ?? "",
        client_phone: fulfilment.clientPhone ?? "",
        client_nationality: fulfilment.nationality ?? "",
        dietary_requirements: fulfilment.dietaryRequirements,
        special_requests: fulfilment.specialRequests,
        shipping_address_line1: fulfilment.shippingLine1 ?? "",
        shipping_address_line2: fulfilment.shippingLine2 ?? "",
        shipping_city: fulfilment.shippingCity ?? "",
        shipping_postcode: fulfilment.shippingPostcode ?? "",
        shipping_country: fulfilment.shippingCountry ?? "",
        billing_address_line1: fulfilment.billingLine1 ?? "",
        billing_address_line2: fulfilment.billingLine2 ?? "",
        billing_city: fulfilment.billingCity ?? "",
        billing_postcode: fulfilment.billingPostcode ?? "",
        billing_country: fulfilment.billingCountry ?? "",
      })
      .eq("id", deal.order_id)
    if (error) return { ok: false, message: error.message }
  }

  const { error: fulfilmentError } = await supabase
    .from("deals")
    .update({
      fulfilment_details: fulfilment,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
  if (fulfilmentError) {
    const missingColumn = fulfilmentError.message.toLowerCase().includes("fulfilment_details")
    const hasEndClient = Object.values(fulfilment).some(Boolean)
    if (missingColumn && hasEndClient && !deal.order_id) {
      return {
        ok: false,
        message: "Apply the latest database migration to save end-client details before an order exists.",
      }
    }
    if (!missingColumn) return { ok: false, message: fulfilmentError.message }
  }

  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/sales-tracker")
  revalidatePath("/admin")
  return { ok: true, message: "Client and fulfilment details updated." }
}

export async function updateDealLineSupplier(input: {
  dealId: string
  lineId: string
  supplierKey: string
  costLayerId?: string | null
  supplierId?: string | null
}): Promise<Result> {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "Sales permission is required." }
  }
  const dealId = input.dealId.trim()
  const lineId = input.lineId.trim()
  if (!dealId || !lineId) return { ok: false, message: "Deal line is not valid." }

  const { data: line, error: lineError } = await supabase
    .from("deal_line_items")
    .select("id, deal_id, package_id, quantity")
    .eq("id", lineId)
    .eq("deal_id", dealId)
    .maybeSingle()
  if (lineError || !line) return { ok: false, message: "Deal product was not found." }

  const clear = !input.supplierKey.trim() || input.supplierKey === "unassigned"
  let supplierId = clear ? null : input.supplierId?.trim() || null
  let costLayerId = clear ? null : input.costLayerId?.trim() || null
  let expectedUnitCost: number | null = null

  if (costLayerId) {
    const { data: layer } = await supabase
      .from("package_cost_layers")
      .select("id, package_id, unit_cost, supplier_id, purchase_order_id")
      .eq("id", costLayerId)
      .maybeSingle()
    if (!layer) return { ok: false, message: "That supplier stock is no longer available." }
    expectedUnitCost = layer.unit_cost == null ? null : Number(layer.unit_cost)
    if (!supplierId) supplierId = layer.supplier_id ?? null
    if (!supplierId && layer.purchase_order_id) {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("supplier_id")
        .eq("id", layer.purchase_order_id)
        .maybeSingle()
      supplierId = po?.supplier_id ?? null
    }
  }

  const { error } = await supabase
    .from("deal_line_items")
    .update({
      supplier_id: supplierId,
      fulfilment_cost_layer_id: costLayerId,
      expected_unit_cost: expectedUnitCost,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lineId)
  if (error) {
    if (error.message.toLowerCase().includes("fulfilment_cost_layer_id")) {
      return {
        ok: false,
        message: "Apply the latest database migration to assign a supplier on this deal.",
      }
    }
    return { ok: false, message: error.message }
  }

  const { data: deal } = await supabase.from("deals").select("order_id").eq("id", dealId).maybeSingle()
  if (deal?.order_id) {
    await supabase
      .from("order_supplier_fulfilments")
      .update({
        supplier_id: supplierId,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", deal.order_id)
      .eq("package_id", line.package_id)
  }

  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/catalog", "layout")
  return { ok: true, message: "Supplier updated." }
}

export async function addDealNote(input: { dealId: string; note: string }): Promise<Result> {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "Sales permission is required." }
  }
  const dealId = input.dealId.trim()
  const note = input.note.trim()
  if (!dealId) return { ok: false, message: "Deal id is not valid." }
  if (!note) return { ok: false, message: "Write a note before saving." }

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .maybeSingle()
  if (dealError || !deal) return { ok: false, message: "Deal was not found." }

  const { error: activityError } = await supabase.from("deal_activities").insert({
    deal_id: dealId,
    actor_profile_id: profile.id,
    action: "note",
    summary: note,
    metadata: {},
  })
  if (activityError) return { ok: false, message: activityError.message }

  await supabase
    .from("deals")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", dealId)

  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/sales-tracker")
  revalidatePath("/admin")
  return { ok: true, message: "Note added." }
}

export async function deleteDeal(input: { dealId: string }): Promise<Result> {
  const [profile, supabase] = await Promise.all([getPortalProfile(), createClient()])
  if (!profile || !hasCmsPermission(profile, "deals.manage")) {
    return { ok: false, message: "Sales permission is required." }
  }
  const dealId = input.dealId.trim()
  if (!dealId) return { ok: false, message: "Deal id is not valid." }

  const { data: lines } = await supabase
    .from("deal_line_items")
    .select("package_id")
    .eq("deal_id", dealId)

  const { error } = await supabase.rpc("admin_delete_deal", { p_deal_id: dealId })
  if (error) {
    const detail = error.message.toLowerCase()
    if (detail.includes("deal_has_order")) {
      return { ok: false, message: "This deal has a portal order. Void the invoice or cancel the order first." }
    }
    if (detail.includes("deal_has_booking_form")) {
      return { ok: false, message: "Void the active booking form before deleting this deal." }
    }
    if (detail.includes("deal_not_found")) {
      return { ok: false, message: "Deal was not found." }
    }
    if (detail.includes("forbidden")) {
      return { ok: false, message: "You do not have permission to delete deals." }
    }
    return { ok: false, message: error.message }
  }

  const { enqueuePackageInventoryChannelSync } = await import("@/lib/integrations/enqueue")
  for (const packageId of new Set((lines ?? []).map((line) => String(line.package_id)).filter(Boolean))) {
    await enqueuePackageInventoryChannelSync(supabase, packageId)
  }

  revalidatePath("/admin/deals", "layout")
  revalidatePath("/admin/inventory/sales-list")
  revalidatePath("/admin/inventory/negative-stock")
  revalidatePath("/admin/sales-tracker")
  revalidatePath("/admin")
  return { ok: true, message: "Deal deleted." }
}

