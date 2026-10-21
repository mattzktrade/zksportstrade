import { NextResponse } from "next/server"
import { verifyAdgpApiSecret } from "@/lib/integrations/adgp/auth"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"
import { attachAdgpHoldSession, createAdgpHold } from "@/lib/integrations/adgp/holds"
import { resolveAdgpAgentProfileId } from "@/lib/integrations/adgp/orders"

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
  const holdId = readString(payload.holdId)
  const stripeSessionId = readString(payload.stripeSessionId)
  if (holdId && stripeSessionId) {
    const attached = await attachAdgpHoldSession({ holdId, stripeSessionId })
    if (!attached.ok) {
      return NextResponse.json({ error: attached.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  const slug = readString(payload.slug)
  const day = readString(payload.day)
  const guests = Math.floor(Number(payload.guests))
  if (!slug || !day) {
    return NextResponse.json({ error: "slug and day are required" }, { status: 400 })
  }

  const agentProfileId = await resolveAdgpAgentProfileId()
  if (!agentProfileId) {
    return NextResponse.json({ error: "ADGP agent profile is not configured" }, { status: 503 })
  }

  const result = await createAdgpHold({ slug, day, guests, agentProfileId })
  if (!result.ok) {
    const status = /sold out|enough seats|insufficient/i.test(result.message) ? 409 : 400
    return NextResponse.json({ error: result.message }, { status })
  }
  return NextResponse.json({ ok: true, hold: result.hold })
}
