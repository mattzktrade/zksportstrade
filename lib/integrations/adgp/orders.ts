import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { sendWebsiteOrderEmail } from "@/lib/email/send-website-order"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"
import type { AdgpAddress, AdgpBuyer, AdgpOrderResult } from "@/lib/integrations/adgp/types"
import { createAdminClient } from "@/lib/supabase/admin"

type OrderRpc = {
  order_id?: string
  order_reference?: string
  deal_id?: string
  deal_reference?: string
  package_name?: string
  circuit?: string
  total_amount?: number
  currency?: string
  guests?: number
  duplicate?: boolean
}

export async function resolveAdgpOwnerProfileId(email: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("profiles")
    .select("id, role")
    .ilike("email", email.trim())
    .limit(1)
    .maybeSingle()
  const role = typeof data?.role === "string" ? data.role : ""
  if (!data?.id || !["admin", "finance", "sales"].includes(role)) return null
  return String(data.id)
}

export async function resolveAdgpAgentProfileId(): Promise<string | null> {
  const config = getAdgpConfig()
  const admin = createAdminClient()
  if (!admin) return null
  if (config?.agentProfileId) {
    const { data } = await admin
      .from("profiles")
      .select("id, approval_status")
      .eq("id", config.agentProfileId)
      .maybeSingle()
    if (data?.id && data.approval_status === "approved") return String(data.id)
  }
  const ownerId = await resolveAdgpOwnerProfileId(config?.ownerEmail ?? "matt@zk-sports.com")
  if (!ownerId) return null
  const { data } = await admin
    .from("profiles")
    .select("id, approval_status")
    .eq("id", ownerId)
    .maybeSingle()
  return data?.approval_status === "approved" ? ownerId : null
}

export async function commitAdgpOrder(input: {
  holdId: string
  stripeSessionId: string
  packageId: string
  guests: number
  unitPrice: number
  currency: string
  buyer: AdgpBuyer
  billing?: AdgpAddress | null
}): Promise<AdgpOrderResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  const config = getAdgpConfig()
  const ownerId = await resolveAdgpOwnerProfileId(config?.ownerEmail ?? "matt@zk-sports.com")
  if (!ownerId) {
    return { ok: false, message: "owner_profile_required", code: "owner_profile_required" }
  }
  const agentId = await resolveAdgpAgentProfileId()
  if (!agentId) {
    return { ok: false, message: "agent_profile_id_required", code: "agent_profile_id_required" }
  }

  const { data: hold } = await admin
    .from("website_checkout_holds")
    .select("id, package_id, guests, unit_price, currency, status")
    .eq("id", input.holdId)
    .maybeSingle()
  if (!hold) return { ok: false, message: "hold_not_found", code: "hold_not_found" }
  if (String(hold.package_id) !== input.packageId) {
    return { ok: false, message: "hold_package_mismatch", code: "hold_package_mismatch" }
  }
  if (Number(hold.guests) !== input.guests) {
    return { ok: false, message: "hold_guests_mismatch", code: "hold_guests_mismatch" }
  }
  if (Math.round(Number(hold.unit_price) * 100) !== Math.round(input.unitPrice * 100)) {
    return { ok: false, message: "hold_price_mismatch", code: "hold_price_mismatch" }
  }
  if ((hold.currency ?? "").trim() && input.currency.trim() && hold.currency !== input.currency) {
    return { ok: false, message: "hold_currency_mismatch", code: "hold_currency_mismatch" }
  }

  const { data, error } = await admin.rpc("place_website_order", {
    p_external_order_id: input.stripeSessionId.trim(),
    p_hold_id: input.holdId,
    p_package_id: input.packageId,
    p_guests: input.guests,
    p_client_name: input.buyer.name.trim(),
    p_client_email: input.buyer.email.trim(),
    p_client_phone: (input.buyer.phone ?? "").trim() || "—",
    p_agent_profile_id: agentId,
    p_owner_profile_id: ownerId,
    p_unit_price: input.unitPrice,
    p_currency: input.currency,
    p_client_nationality: (input.buyer.nationality ?? "").trim(),
    p_bill_line1: input.billing?.line1 ?? "",
    p_bill_line2: input.billing?.line2 ?? null,
    p_bill_city: input.billing?.city ?? "",
    p_bill_postcode: input.billing?.postcode ?? "",
    p_bill_country: input.billing?.country ?? "",
  })
  if (error) {
    return { ok: false, message: error.message, code: error.message }
  }

  const row = data as OrderRpc
  const orderId = String(row.order_id ?? "")
  const dealId = String(row.deal_id ?? "")
  if (!orderId || !dealId) {
    return { ok: false, message: "place_website_order did not return order and deal ids." }
  }

  const result = {
    ok: true as const,
    orderId,
    orderReference: String(row.order_reference ?? ""),
    dealId,
    dealReference: String(row.deal_reference ?? ""),
    packageName: String(row.package_name ?? ""),
    guests: Number(row.guests ?? input.guests),
    totalAmount: Number(row.total_amount ?? input.unitPrice * input.guests),
    currency: String(row.currency ?? input.currency),
    duplicate: Boolean(row.duplicate),
  }

  if (!result.duplicate) {
    const sync = await enqueuePackageInventoryChannelSyncServer(input.packageId, {
      trigger: `website-order:${orderId}`,
    })
    if (!sync.ok) {
      console.warn("[adgp] inventory sync not queued:", sync.message)
    }
    const mail = await sendWebsiteOrderEmail({
      orderReference: result.orderReference,
      dealReference: result.dealReference,
      packageName: result.packageName,
      guests: result.guests,
      totalAmount: result.totalAmount,
      currency: result.currency,
      clientName: input.buyer.name,
      clientEmail: input.buyer.email,
      clientPhone: input.buyer.phone ?? "",
    })
    if (!mail.ok && !mail.skipped) {
      console.error("[adgp] website order email failed:", mail.error)
    }
  }

  return result
}
