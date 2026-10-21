import { NextResponse } from "next/server"
import { sendWebsiteOrderEmail } from "@/lib/email/send-website-order"
import { verifyAdgpApiSecret } from "@/lib/integrations/adgp/auth"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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
  const reason = readString(payload.reason) || "Checkout commit failed after payment."
  const sessionId = readString(payload.stripeSessionId)
  const packageName = readString(payload.packageName) || "Unknown package"
  const mail = await sendWebsiteOrderEmail({
    orderReference: sessionId || "uncommitted",
    dealReference: "not created",
    packageName,
    guests: Math.max(1, Math.floor(Number(payload.guests) || 1)),
    totalAmount: Number(payload.totalAmount) || 0,
    currency: readString(payload.currency) || "USD",
    clientName: readString(payload.clientName) || "Unknown",
    clientEmail: readString(payload.clientEmail) || "",
    clientPhone: `${readString(payload.clientPhone)} — ${reason}`,
  })
  if (!mail.ok && !mail.skipped) {
    return NextResponse.json({ error: mail.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, skipped: mail.skipped ?? null })
}
