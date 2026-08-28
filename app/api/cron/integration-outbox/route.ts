import { NextResponse } from "next/server"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 })
  }

  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
  const headerSecret = request.headers.get("x-cron-secret")?.trim()
  const bearerOk = Boolean(bearer && safeEqualStrings(bearer, secret))
  const headerOk = Boolean(headerSecret && safeEqualStrings(headerSecret, secret))
  if (!bearerOk && !headerOk) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const { runIntegrationCronJob } = await import("@/lib/integrations/run-integration-cron")
    const result = await runIntegrationCronJob()
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Integration cron failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
