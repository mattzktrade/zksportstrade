"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getPortalProfile } from "@/lib/supabase/profile"
import { sendOrderPlacedEmail } from "@/lib/email/send-order-placed"

export type SubmitCheckoutResult =
  | {
      ok: true
      orderReference: string
      invoiceReference: string
      orderId: string
      totalAmount: number
      currency: string
      guests: number
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

export async function submitCheckoutOrder(input: {
  packageId: string
  guests: number
  clientName: string
  clientEmail: string
  clientPhone: string
  clientCompany: string
  dietaryRequirements: string
  specialRequests: string
  poNumber: string
}): Promise<SubmitCheckoutResult> {
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
    p_client_company: input.clientCompany,
    p_dietary: input.dietaryRequirements,
    p_special: input.specialRequests,
    p_po: input.poNumber,
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

  revalidatePath("/bookings")
  revalidatePath("/invoices")

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
    clientCompany: input.clientCompany.trim(),
    poNumber: input.poNumber.trim() || null,
    dietary: input.dietaryRequirements.trim() || null,
    specialRequests: input.specialRequests.trim() || null,
  })

  if (!emailResult.ok && emailResult.error) {
    console.error("[checkout] order saved but email failed:", emailResult.error)
  } else if (!emailResult.ok && emailResult.skipped) {
    console.warn("[checkout] order saved; email skipped:", emailResult.skipped)
  }

  return {
    ok: true,
    orderReference,
    invoiceReference,
    orderId,
    totalAmount,
    currency,
    guests: guestCount,
  }
}
