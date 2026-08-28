import { createHmac } from "crypto"
import { after, NextResponse } from "next/server"
import { getXeroCredentials } from "@/lib/integrations/xero/config"
import { markPortalInvoicePaidFromXero } from "@/lib/integrations/xero/invoices"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

type XeroWebhookEvent = {
  resourceId?: string
  eventType?: string
  eventCategory?: string
  tenantId?: string
}

async function processXeroEvents(events: XeroWebhookEvent[]): Promise<void> {
  for (const ev of events) {
    if (ev.eventCategory !== "INVOICE") continue
    const type = (ev.eventType ?? "").toUpperCase()
    if (type === "UPDATE" && ev.resourceId) {
      try {
        await markPortalInvoicePaidFromXero(ev.resourceId)
      } catch (e) {
        console.error("[xero webhook] invoice update:", e instanceof Error ? e.message : e)
      }
    }
  }
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

  const events = payload.events ?? []
  after(() => processXeroEvents(events))

  return NextResponse.json({ ok: true })
}
