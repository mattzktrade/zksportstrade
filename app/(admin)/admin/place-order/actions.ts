"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import { isGuestCountAllowed, numericSellable } from "@/lib/catalog/booking-guests"
import { getPackageById } from "@/lib/catalog/queries"
import { sendOrderPlacedEmail } from "@/lib/email/send-order-placed"
import { mapPlaceOrderError } from "@/lib/orders/place-order-errors"
import type { CheckoutAddressFields } from "@/lib/types/checkout-addresses"
import type { Package } from "@/lib/types/catalog"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SubmitAdminOrderResult =
  | {
      ok: true
      orderReference: string
      agentEmail: string
      agentCompany: string
      confirmationEmailSent: boolean
      confirmationEmailNotice?: string
    }
  | { ok: false; error: string }

export async function getAdminOrderPackagePreview(
  agentProfileId: string,
  packageId: string,
): Promise<Package | null> {
  const gate = await requireAdminAction()
  if (!gate.ok) return null
  const agentId = agentProfileId.trim()
  const pkgId = packageId.trim()
  if (!UUID_RE.test(agentId) || !pkgId) return null
  return getPackageById(pkgId, agentId)
}

export async function submitAdminOrderForAgent(
  input: {
    agentProfileId: string
    packageId: string
    guests: number
    clientName: string
    clientEmail: string
    clientPhone: string
    clientNationality: string
    dietaryRequirements: string
    specialRequests: string
    poNumber: string
    updateAgentAddressDefaults: boolean
  } & CheckoutAddressFields,
): Promise<SubmitAdminOrderResult> {
  const gate = await requireAdminAction()
  if (!gate.ok) return { ok: false, error: gate.message }

  const agentId = input.agentProfileId.trim()
  if (!UUID_RE.test(agentId)) return { ok: false, error: "Invalid agent." }

  const guests = Math.floor(Number(input.guests))
  if (!Number.isFinite(guests) || guests < 1) {
    return { ok: false, error: "Guest count is invalid." }
  }

  const { supabase } = gate

  const { data: agent, error: agentErr } = await supabase
    .from("profiles")
    .select("id, email, full_name, company_name, approval_status, role")
    .eq("id", agentId)
    .maybeSingle()

  if (agentErr || !agent) return { ok: false, error: "Agent account was not found." }
  if (agent.role !== "agent" || agent.approval_status !== "approved") {
    return { ok: false, error: "This agent account is not approved to place orders yet." }
  }

  const pkg = await getPackageById(input.packageId, agentId)
  if (!pkg || pkg.price === null) {
    return { ok: false, error: "This package is not available to book." }
  }
  const sellable = numericSellable(pkg.availability)
  if (sellable === null || sellable < 1) {
    return { ok: false, error: "This package has no bookable stock." }
  }
  if (!isGuestCountAllowed(sellable, guests)) {
    return {
      ok: false,
      error:
        "This quantity would leave a single place unsold. When only a few places remain, book all remaining places together or choose a smaller group.",
    }
  }

  const { data, error } = await supabase.rpc("place_order", {
    p_package_id: input.packageId,
    p_guests: guests,
    p_client_name: input.clientName,
    p_client_email: input.clientEmail,
    p_client_phone: input.clientPhone,
    p_client_nationality: input.clientNationality,
    p_dietary: input.dietaryRequirements,
    p_special: input.specialRequests,
    p_po: input.poNumber,
    p_ship_line1: input.shippingAddressLine1,
    p_ship_line2: input.shippingAddressLine2,
    p_ship_city: input.shippingCity,
    p_ship_postcode: input.shippingPostcode,
    p_ship_country: input.shippingCountry,
    p_bill_line1: input.billingAddressLine1,
    p_bill_line2: input.billingAddressLine2,
    p_bill_city: input.billingCity,
    p_bill_postcode: input.billingPostcode,
    p_bill_country: input.billingCountry,
    p_agent_profile_id: agentId,
  })

  if (error) {
    return { ok: false, error: mapPlaceOrderError(error.message ?? "") }
  }

  const row = data as Record<string, unknown> | null
  if (!row || typeof row.order_reference !== "string") {
    return { ok: false, error: "Unexpected response from server." }
  }

  if (input.updateAgentAddressDefaults) {
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({
        shipping_address_line1: input.shippingAddressLine1.trim(),
        shipping_address_line2: input.shippingAddressLine2.trim(),
        shipping_city: input.shippingCity.trim(),
        shipping_postcode: input.shippingPostcode.trim(),
        shipping_country: input.shippingCountry.trim(),
        billing_address_line1: input.billingAddressLine1.trim(),
        billing_address_line2: input.billingAddressLine2.trim(),
        billing_city: input.billingCity.trim(),
        billing_postcode: input.billingPostcode.trim(),
        billing_country: input.billingCountry.trim(),
      })
      .eq("id", agentId)

    if (profileErr) {
      console.error("[admin place-order] order saved but agent address defaults not updated:", profileErr.message)
    }
  }

  revalidatePath("/bookings")
  revalidatePath("/packages")
  revalidatePath("/admin/orders")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/agents")

  const agentEmail = agent.email
  const agentName = agent.full_name || agent.email.split("@")[0] || "Partner"
  const orderReference = row.order_reference as string
  const totalAmount = Number(row.total_amount ?? 0)
  const currency = String(row.currency ?? "USD")
  const guestCount = Number(row.guests ?? guests)

  const emailResult = await sendOrderPlacedEmail({
    agentEmail,
    agentName,
    orderReference,
    packageName: String(row.package_name ?? ""),
    circuit: String(row.circuit ?? ""),
    guests: guestCount,
    totalAmount,
    currency,
    clientName: input.clientName.trim(),
    clientEmail: input.clientEmail.trim(),
    clientPhone: input.clientPhone.trim(),
    clientNationality: input.clientNationality.trim(),
    poNumber: input.poNumber.trim() || null,
    dietary: input.dietaryRequirements.trim() || null,
    specialRequests: input.specialRequests.trim() || null,
    shippingAddressLine1: input.shippingAddressLine1.trim(),
    shippingAddressLine2: input.shippingAddressLine2.trim(),
    shippingCity: input.shippingCity.trim(),
    shippingPostcode: input.shippingPostcode.trim(),
    shippingCountry: input.shippingCountry.trim(),
    billingAddressLine1: input.billingAddressLine1.trim(),
    billingAddressLine2: input.billingAddressLine2.trim(),
    billingCity: input.billingCity.trim(),
    billingPostcode: input.billingPostcode.trim(),
    billingCountry: input.billingCountry.trim(),
  })

  let confirmationEmailSent = emailResult.ok
  let confirmationEmailNotice: string | undefined
  if (!emailResult.ok) {
    if (emailResult.skipped) {
      confirmationEmailNotice =
        "Order saved, but confirmation email is not configured on this server (RESEND_API_KEY / ORDER_EMAIL_FROM)."
    } else if (emailResult.error) {
      confirmationEmailNotice = `Order saved, but the confirmation email could not be sent (${emailResult.error}).`
    }
  }

  return {
    ok: true,
    orderReference,
    agentEmail,
    agentCompany: agent.company_name || agent.full_name || agent.email,
    confirmationEmailSent,
    confirmationEmailNotice,
  }
}
