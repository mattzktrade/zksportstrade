import { NextResponse } from "next/server"
import { getInboundEmailWebhookSecret } from "@/lib/assistant/email-inbound-config"
import { handleInboundSalesEmail } from "@/lib/assistant/email-inbound"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

function secretFromRequest(request: Request): string {
  return (
    request.headers.get("x-webhook-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  )
}

export async function POST(request: Request) {
  const expected = getInboundEmailWebhookSecret()
  if (!expected) {
    return NextResponse.json({ error: "Email reply webhook is not configured" }, { status: 503 })
  }
  const provided = secretFromRequest(request)
  if (!provided || !safeEqualStrings(provided, expected)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 })
  }

  const rawBody = await request.text()
  let body: unknown
  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const result = await handleInboundSalesEmail(body)
  return NextResponse.json(result)
}
