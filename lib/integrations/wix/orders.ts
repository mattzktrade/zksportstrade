import { enqueueOrderIntegrationsServer } from "@/lib/integrations/enqueue-server"
import { getWixConfig } from "@/lib/integrations/wix/config"
import { createAdminClient } from "@/lib/supabase/admin"

export type WixOrderWebhookPayload = {
  orderId: string
  productId: string
  variantId?: string | null
  quantity: number
  unitPrice?: number | null
  currency?: string | null
  buyer: {
    name: string
    email: string
    phone?: string | null
  }
  shipping?: {
    line1?: string
    line2?: string
    city?: string
    postcode?: string
    country?: string
  } | null
}

export type PlaceWixOrderResult =
  | { ok: true; orderId: string; orderReference: string; duplicate: boolean }
  | { ok: false; message: string }

/** Resolve portal package_id from Wix product / variant via channel_listings. */
export async function resolvePackageIdFromWixProduct(input: {
  productId: string
  variantId?: string | null
}): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const productId = input.productId.trim()
  const variantId = input.variantId?.trim() || null

  if (variantId) {
    const { data } = await admin
      .from("channel_listings")
      .select("package_id")
      .eq("channel", "wix")
      .eq("external_id", productId)
      .eq("external_variant_id", variantId)
      .maybeSingle()
    if (data?.package_id) return String(data.package_id)
  }

  const { data: rows } = await admin
    .from("channel_listings")
    .select("package_id")
    .eq("channel", "wix")
    .eq("external_id", productId)
    .limit(2)

  if (!rows?.length) return null
  if (rows.length > 1 && !variantId) {
    throw new Error(
      `Wix product ${productId} maps to multiple portal packages — set variantId on the webhook or add external_variant_id on each mapping row.`,
    )
  }
  return String(rows[0].package_id)
}

export async function placeWixOrderFromWebhook(
  payload: WixOrderWebhookPayload,
): Promise<PlaceWixOrderResult> {
  const config = getWixConfig()
  if (!config?.agentProfileId) {
    return {
      ok: false,
      message: "WIX_AGENT_PROFILE_ID is not set — use an approved admin/agent profile uuid.",
    }
  }

  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const packageId = await resolvePackageIdFromWixProduct({
    productId: payload.productId,
    variantId: payload.variantId,
  })
  if (!packageId) {
    return {
      ok: false,
      message: `No channel_listings mapping for Wix product ${payload.productId}.`,
    }
  }

  const guests = Math.max(1, Math.floor(Number(payload.quantity) || 1))
  const ship = payload.shipping ?? {}

  const { data, error } = await admin.rpc("place_wix_order", {
    p_external_order_id: payload.orderId.trim(),
    p_package_id: packageId,
    p_guests: guests,
    p_client_name: payload.buyer.name.trim(),
    p_client_email: payload.buyer.email.trim(),
    p_client_phone: (payload.buyer.phone ?? "").trim() || "—",
    p_client_nationality: "",
    p_dietary: null,
    p_special: null,
    p_po: null,
    p_ship_line1: ship.line1 ?? "",
    p_ship_line2: ship.line2 ?? null,
    p_ship_city: ship.city ?? "",
    p_ship_postcode: ship.postcode ?? "",
    p_ship_country: ship.country ?? "",
    p_bill_line1: ship.line1 ?? "",
    p_bill_line2: ship.line2 ?? null,
    p_bill_city: ship.city ?? "",
    p_bill_postcode: ship.postcode ?? "",
    p_bill_country: ship.country ?? "",
    p_agent_profile_id: config.agentProfileId,
    p_unit_price: payload.unitPrice ?? null,
    p_currency: payload.currency ?? null,
  })

  if (error) return { ok: false, message: error.message }

  const row = data as {
    order_id?: string
    order_reference?: string
    duplicate?: boolean
  }

  const orderId = String(row.order_id ?? "")
  const orderReference = String(row.order_reference ?? "")
  const duplicate = Boolean(row.duplicate)

  if (!orderId) return { ok: false, message: "place_wix_order did not return order_id." }

  if (!duplicate) {
    const enq = await enqueueOrderIntegrationsServer(orderId, "wix")
    if (!enq.ok) {
      return {
        ok: false,
        message: `Order ${orderReference} created but Salesforce/Xero sync was not queued: ${enq.message}`,
      }
    }
  }

  return { ok: true, orderId, orderReference, duplicate }
}
