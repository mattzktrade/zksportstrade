import { NextResponse } from "next/server"
import { verifyAdgpApiSecret } from "@/lib/integrations/adgp/auth"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"
import { commitAdgpOrder } from "@/lib/integrations/adgp/orders"
import { createAdminClient } from "@/lib/supabase/admin"

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

export async function GET(request: Request) {
  const config = getAdgpConfig()
  if (!config) {
    return NextResponse.json({ error: "ADGP API is not configured" }, { status: 503 })
  }
  if (!verifyAdgpApiSecret(request, config.apiSecret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 })
  }

  const url = new URL(request.url)
  const sessionId = url.searchParams.get("stripeSessionId")?.trim() || ""
  if (!sessionId) {
    return NextResponse.json({ error: "stripeSessionId is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Service role is not configured" }, { status: 503 })
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, reference, deal_id, guests, total_amount, currency, package_id")
    .eq("external_order_id", sessionId)
    .maybeSingle()
  if (!order) {
    return NextResponse.json({ ok: true, pending: true })
  }
  const { data: deal } = order.deal_id
    ? await admin.from("deals").select("id, reference").eq("id", order.deal_id).maybeSingle()
    : { data: null }
  const { data: pkg } = order.package_id
    ? await admin.from("packages").select("name").eq("id", order.package_id).maybeSingle()
    : { data: null }
  const { data: hold } = await admin
    .from("website_checkout_holds")
    .select("day, slug")
    .eq("stripe_session_id", sessionId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    pending: false,
    orderId: order.id,
    orderReference: order.reference,
    dealId: deal?.id ?? order.deal_id,
    dealReference: deal?.reference ?? null,
    packageName: pkg?.name ?? null,
    day: hold?.day ?? null,
    guests: order.guests,
    totalAmount: order.total_amount,
    currency: order.currency,
  })
}

export async function POST(request: Request) {
  const config = getAdgpConfig()
  if (!config) {
    return NextResponse.json({ error: "ADGP API is not configured" }, { status: 503 })
  }
  if (!verifyAdgpApiSecret(request, config.apiSecret)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const buyer = payload.buyer && typeof payload.buyer === "object" ? (payload.buyer as Record<string, unknown>) : {}
  const billing =
    payload.billing && typeof payload.billing === "object" ? (payload.billing as Record<string, unknown>) : {}

  const result = await commitAdgpOrder({
    holdId: readString(payload.holdId),
    stripeSessionId: readString(payload.stripeSessionId),
    packageId: readString(payload.packageId),
    guests: Math.floor(readNumber(payload.guests)),
    unitPrice: readNumber(payload.unitPrice),
    currency: readString(payload.currency) || "USD",
    buyer: {
      name: readString(buyer.name) || readString(payload.clientName),
      email: readString(buyer.email) || readString(payload.clientEmail),
      phone: readString(buyer.phone) || readString(payload.clientPhone),
      nationality: readString(buyer.nationality),
    },
    billing: {
      line1: readString(billing.line1),
      line2: readString(billing.line2),
      city: readString(billing.city),
      postcode: readString(billing.postcode),
      country: readString(billing.country),
    },
  })

  if (!result.ok) {
    const retryable = /hold_not_found|owner_profile|agent_profile|Service role|not configured/i.test(
      result.message,
    )
    return NextResponse.json({ error: result.message, code: result.code }, { status: retryable ? 409 : 400 })
  }

  return NextResponse.json(result)
}
