import { NextResponse } from "next/server"
import { verifyAdgpApiSecret } from "@/lib/integrations/adgp/auth"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"
import { releaseAdgpHold } from "@/lib/integrations/adgp/holds"

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
  const result = await releaseAdgpHold({
    holdId: readString(payload.holdId) || null,
    stripeSessionId: readString(payload.stripeSessionId) || null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, duplicate: result.duplicate === true })
}
