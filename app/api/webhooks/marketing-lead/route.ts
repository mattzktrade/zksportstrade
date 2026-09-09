import { NextResponse } from "next/server"
import { getMarketingLeadConfig } from "@/lib/integrations/marketing-leads/config"
import { ingestMarketingLead } from "@/lib/integrations/marketing-leads/ingest"
import { parseMarketingLeadWebhookBody } from "@/lib/integrations/marketing-leads/parse"
import { verifyMarketingLeadWebhook } from "@/lib/integrations/marketing-leads/verify"

export async function POST(request: Request) {
  const config = getMarketingLeadConfig()
  const rawBody = await request.text()

  if (!config) {
    return NextResponse.json({ error: "Marketing lead webhook secret is not configured" }, { status: 503 })
  }

  if (!verifyMarketingLeadWebhook(request, rawBody, config.webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseMarketingLeadWebhookBody(body)
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error,
        hint: "Send leadId, contact name, and email or phone. Nested contact/interest or flat Zapier/Meta field_data are accepted.",
      },
      { status: 400 },
    )
  }

  try {
    const result = await ingestMarketingLead(parsed.payload)
    if (!result.ok) {
      const retrying = /already being imported/i.test(result.message)
      return NextResponse.json({ error: result.message }, { status: retrying ? 409 : 400 })
    }
    return NextResponse.json({
      ok: true,
      dealId: result.dealId,
      dealReference: result.dealReference,
      duplicate: result.duplicate,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketing lead processing failed"
    console.error("[marketing-lead webhook]", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
