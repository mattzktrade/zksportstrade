"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getPortalProfile } from "@/lib/supabase/profile"
import { sendOrderPlacedEmail } from "@/lib/email/send-order-placed"
import type { CheckoutAddressFields } from "@/lib/types/checkout-addresses"

export type SubmitCheckoutResult =
  | {
      ok: true
      orderReference: string
      invoiceReference: string
      orderId: string
      totalAmount: number
      currency: string
      guests: number
      /** Whether Resend accepted the confirmation email */
      confirmationEmailSent: boolean
      /** User-safe hint when email was not sent (e.g. missing Vercel env) */
      confirmationEmailNotice?: string
    }
  | { ok: false; error: string }

function mapRpcError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("insufficient_stock")) return "Not enough capacity left for this package. Try fewer guests or another date."
  if (m.includes("not_approved")) return "Your account is not approved to place orders yet."
  if (m.includes("not_authenticated")) return "Please sign in again."
  if (m.includes("package_enquiry_only")) return "This package cannot be booked online."
  if (m.includes("package_price_missing")) return "This package has no trade price and cannot be booked online."
  if (m.includes("package_not_found")) return "Package was not found."
  if (m.includes("inventory_missing")) return "Inventory is not set up for this package."
  if (m.includes("invalid_guests")) return "Guest count is invalid."
  return "Could not complete the booking. Please try again or contact support."
}

export async function submitCheckoutOrder(
  input: {
    packageId: string
    guests: number
    clientName: string
    clientEmail: string
    clientPhone: string
    clientNationality: string
    dietaryRequirements: string
    specialRequests: string
    poNumber: string
  } & CheckoutAddressFields,
): Promise<SubmitCheckoutResult> {
  const profile = await getPortalProfile()
  if (!profile || profile.approval_status !== "approved") {
    return { ok: false, error: "Your account is not approved to place orders yet." }
  }

  const guests = Math.floor(Number(input.guests))
  if (!Number.isFinite(guests) || guests < 1) {
    return { ok: false, error: "Guest count is invalid." }
  }

  const supabase = await createClient()
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
  })

  if (error) {
    return { ok: false, error: mapRpcError(error.message ?? "") }
  }

  const row = data as Record<string, unknown> | null
  if (!row || typeof row.order_reference !== "string") {
    return { ok: false, error: "Unexpected response from server." }
  }

  const orderReference = row.order_reference as string
  const invoiceReference = (row.invoice_reference as string) ?? ""
  const orderId = String(row.order_id ?? "")
  const totalAmount = Number(row.total_amount ?? 0)
  const currency = String(row.currency ?? "USD")
  const guestCount = Number(row.guests ?? guests)

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
    .eq("id", profile.id)

  if (profileErr) {
    console.error("[checkout] order saved but profile address defaults not updated:", profileErr.message)
  }

  revalidatePath("/bookings")
  revalidatePath("/invoices")
  revalidatePath("/profile")
  revalidatePath("/packages")
  revalidatePath("/admin/inventory")
  revalidatePath("/admin/catalog")

  const agentEmail = profile.email
  const agentName = profile.full_name || profile.email.split("@")[0] || "Partner"

  const emailResult = await sendOrderPlacedEmail({
    agentEmail,
    agentName,
    orderReference,
    invoiceReference,
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

  if (!emailResult.ok && emailResult.error) {
    console.error("[checkout] order saved but email failed:", emailResult.error)
  } else if (!emailResult.ok && emailResult.skipped) {
    console.warn("[checkout] order saved; email skipped:", emailResult.skipped)
  }

  let confirmationEmailSent = emailResult.ok
  let confirmationEmailNotice: string | undefined
  if (!emailResult.ok) {
    if (emailResult.skipped) {
      confirmationEmailNotice =
        "Your booking was saved, but confirmation email is not configured on this server. In Vercel → Project → Settings → Environment Variables, set RESEND_API_KEY and ORDER_EMAIL_FROM for Production, then redeploy."
    } else if (emailResult.error) {
      confirmationEmailNotice = `Your booking was saved, but the confirmation email could not be sent (${emailResult.error}). Check Vercel logs, Resend domain verification, and spam.`
    }
  }

  return {
    ok: true,
    orderReference,
    invoiceReference,
    orderId,
    totalAmount,
    currency,
    guests: guestCount,
    confirmationEmailSent,
    confirmationEmailNotice,
  }
}
