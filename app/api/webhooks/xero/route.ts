import { createHmac, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { getXeroCredentials } from "@/lib/integrations/xero/config"
import { drainOutboxNow } from "@/lib/integrations/schedule-drain"
import { markPortalInvoicePaidFromXero } from "@/lib/integrations/xero/invoices"

type XeroWebhookEvent = {
  resourceId?: string
  eventType?: string
  eventCategory?: string
  tenantId?: string
}

function safeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function POST(request: Request) {
  const creds = getXeroCredentials()
  const rawBody = await request.text()

  if (!creds?.webhookKey) {
    return NextResponse.json({ error: "Xero webhook key is not configured" }, { status: 503 })
  }

  const signature = request.headers.get("x-xero-signature") ?? ""
  const expected = createHmac("sha256", creds.webhookKey).update(rawBody).digest("base64")
  if (!safeEqualStrings(signature, expected)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: { events?: XeroWebhookEvent[] }
  try {
    payload = JSON.parse(rawBody) as { events?: XeroWebhookEvent[] }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  for (const ev of payload.events ?? []) {
    if (ev.eventCategory !== "INVOICE") continue
    const type = (ev.eventType ?? "").toUpperCase()
    if (type === "UPDATE" && ev.resourceId) {
      try {
        await markPortalInvoicePaidFromXero(ev.resourceId)
        await drainOutboxNow({ maxRounds: 5 })
      } catch (e) {
        console.error("[xero webhook] invoice update:", e instanceof Error ? e.message : e)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
