import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { isOutreachStopKeyword } from "@/lib/integrations/marketing-leads/outreach-labels"
import { findActiveOutreachByEmail } from "@/lib/integrations/marketing-leads/outreach-store"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"
import { parseAssistantEmailEvent } from "@/lib/assistant/email-parse"
import { ingestAssistantEvent } from "@/lib/assistant/ingest"

function secretFromRequest(request: Request): string {
  return (
    request.headers.get("x-webhook-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  )
}

function expectedEmailWebhookSecret(): string | null {
  return (
    process.env.ASSISTANT_EMAIL_WEBHOOK_SECRET?.trim() ||
    process.env.MARKETING_OUTREACH_EMAIL_WEBHOOK_SECRET?.trim() ||
    null
  )
}

export async function POST(request: Request) {
  const expected = expectedEmailWebhookSecret()
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

  const event = parseAssistantEmailEvent(body)
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: true, skipped: true })

  if (event?.fromEmail) {
    const enrollment = await findActiveOutreachByEmail(admin, event.fromEmail)
    if (enrollment) {
      const reason = isOutreachStopKeyword(event.body) ? "stop_keyword" : "replied"
      await stopMarketingOutreach(enrollment.deal_id, reason)
      if (reason === "replied") {
        await admin
          .from("deals")
          .update({
            enquiry_stage: "responded",
            next_action: suggestedEnquiryAction("responded"),
            updated_at: new Date().toISOString(),
          })
          .eq("id", enrollment.deal_id)
          .in("enquiry_stage", ["new", "contacted"])
      }
    }
    try {
      await ingestAssistantEvent(event)
    } catch (error) {
      console.error("[assistant-email]", error instanceof Error ? error.message : "Ingest failed.")
    }
  }

  return NextResponse.json({ ok: true })
}
