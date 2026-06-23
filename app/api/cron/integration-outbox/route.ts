import { runIntegrationCronJob } from "@/lib/integrations/run-integration-cron"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 })
  }

  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
  const headerSecret = request.headers.get("x-cron-secret")?.trim()
  if (bearer !== secret && headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const result = await runIntegrationCronJob()
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Integration cron failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
