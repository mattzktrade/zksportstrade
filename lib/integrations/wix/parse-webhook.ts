import type { WixOrderWebhookPayload } from "@/lib/integrations/wix/orders"

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : ""
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalise Wix / Velo / custom automation payloads into our canonical shape.
 * Supports a simple JSON body (documented in PHASE4_WIX_SETUP.md) and common Wix Stores fields.
 */
export function parseWixOrderWebhookBody(body: unknown): WixOrderWebhookPayload | null {
  if (!body || typeof body !== "object") return null
  const o = body as Record<string, unknown>

  const orderId =
    str(o.orderId) ||
    str(o.order_id) ||
    str(o.id) ||
    str((o.data as Record<string, unknown> | undefined)?.orderId)

  const line =
    (Array.isArray(o.lineItems) ? o.lineItems[0] : null) ??
    (Array.isArray(o.items) ? o.items[0] : null) ??
    (Array.isArray((o.data as Record<string, unknown> | undefined)?.lineItems)
      ? (o.data as { lineItems: unknown[] }).lineItems[0]
      : null)

  const lineObj = line && typeof line === "object" ? (line as Record<string, unknown>) : {}

  const productId =
    str(o.productId) ||
    str(o.product_id) ||
    str(lineObj.productId) ||
    str(lineObj.product_id) ||
    str(lineObj.catalogReferenceId)

  const variantId =
    str(o.variantId) ||
    str(o.variant_id) ||
    str(lineObj.variantId) ||
    str(lineObj.variant_id) ||
    null

  const quantity =
    num(o.quantity) ??
    num(lineObj.quantity) ??
    num((o.data as Record<string, unknown> | undefined)?.quantity) ??
    1

  const buyerRaw =
    (o.buyer && typeof o.buyer === "object" ? o.buyer : null) ??
    (o.customer && typeof o.customer === "object" ? o.customer : null) ??
    (o.contact && typeof o.contact === "object" ? o.contact : null)

  const buyerObj = (buyerRaw ?? {}) as Record<string, unknown>
  const buyerName =
    str(buyerObj.name) ||
    [str(buyerObj.firstName), str(buyerObj.lastName)].filter(Boolean).join(" ") ||
    str(o.client_name) ||
    "Wix customer"
  const buyerEmail = str(buyerObj.email) || str(o.client_email) || str(o.email)
  const buyerPhone = str(buyerObj.phone) || str(o.client_phone) || str(o.phone) || null

  if (!orderId || !productId || !buyerEmail) return null

  const shipRaw = o.shipping && typeof o.shipping === "object" ? (o.shipping as Record<string, unknown>) : null

  return {
    orderId,
    productId,
    variantId: variantId || null,
    quantity: Math.max(1, Math.floor(quantity)),
    unitPrice: num(o.unitPrice) ?? num(o.unit_price) ?? num(lineObj.price),
    currency: str(o.currency) || str(lineObj.currency) || null,
    buyer: { name: buyerName, email: buyerEmail, phone: buyerPhone },
    shipping: shipRaw
      ? {
          line1: str(shipRaw.line1) || str(shipRaw.addressLine1),
          line2: str(shipRaw.line2) || str(shipRaw.addressLine2) || undefined,
          city: str(shipRaw.city),
          postcode: str(shipRaw.postcode) || str(shipRaw.zipCode),
          country: str(shipRaw.country),
        }
      : null,
  }
}
