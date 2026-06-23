import { createHmac, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { drainOutboxNow } from "@/lib/integrations/schedule-drain"
import { getWixConfig } from "@/lib/integrations/wix/config"
import { placeWixOrderFromWebhook } from "@/lib/integrations/wix/orders"
import { parseWixOrderWebhookBody } from "@/lib/integrations/wix/parse-webhook"

function safeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function verifyWebhookSecret(request: Request, rawBody: string, secret: string): boolean {
  const header = request.headers.get("x-wix-webhook-secret") ?? request.headers.get("x-webhook-secret") ?? ""
  if (header && safeEqualStrings(header, secret)) return true

  const signature = request.headers.get("x-wix-signature") ?? ""
  if (signature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
    return safeEqualStrings(signature, expected)
  }

  return false
}

export async function POST(request: Request) {
  const config = getWixConfig()
  const rawBody = await request.text()

  if (!config?.webhookSecret) {
    return NextResponse.json({ error: "Wix webhook secret is not configured" }, { status: 503 })
  }

  if (!verifyWebhookSecret(request, rawBody, config.webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseWixOrderWebhookBody(body)
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Unrecognised payload. Send orderId, productId, quantity, and buyer.email — see docs/PHASE4_WIX_SETUP.md.",
      },
      { status: 400 },
    )
  }

  try {
    const result = await placeWixOrderFromWebhook(parsed)
    if (!result.ok) {
      const status = result.message.includes("insufficient_stock") ? 409 : 400
      return NextResponse.json({ error: result.message }, { status })
    }

    if (!result.duplicate) {
      await drainOutboxNow({ maxRounds: 10 })
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      orderReference: result.orderReference,
      duplicate: result.duplicate,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wix order processing failed"
    console.error("[wix webhook]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
