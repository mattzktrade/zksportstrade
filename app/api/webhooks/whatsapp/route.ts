import { createHmac } from "crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { getWhatsAppAppSecret, getWhatsAppWebhookVerifyToken } from "@/lib/integrations/marketing-leads/outreach-config"
import { isOutreachStopKeyword } from "@/lib/integrations/marketing-leads/outreach-labels"
import { findActiveOutreachByPhone } from "@/lib/integrations/marketing-leads/outreach-store"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"
import { ingestAssistantEvent } from "@/lib/assistant/ingest"
import { collectWhatsAppInboundMessages, parseWhatsAppAssistantEvents } from "@/lib/assistant/whatsapp-parse"

function header(request: Request, name: string): string {
  return request.headers.get(name)?.trim() || ""
}

export async function GET(request: Request) {
  const verifyToken = getWhatsAppWebhookVerifyToken()
  const url = new URL(request.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export async function POST(request: Request) {
  const appSecret = getWhatsAppAppSecret()
  if (!appSecret) {
    return NextResponse.json({ error: "WhatsApp webhook secret is not configured" }, { status: 503 })
  }
  const rawBody = await request.text()
  const signature = header(request, "x-hub-signature-256")
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`
  if (!safeEqualStrings(signature, expected)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody) as unknown
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: true, skipped: true })

  for (const message of collectWhatsAppInboundMessages(body)) {
    const from = (message.from ?? "").replace(/\D/g, "")
    if (from.length < 8) continue
    const enrollment = await findActiveOutreachByPhone(admin, from)
    if (!enrollment) continue
    const text = message.text?.body ?? ""
    const reason = isOutreachStopKeyword(text) ? "stop_keyword" : "replied"
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

  for (const event of parseWhatsAppAssistantEvents(body)) {
    try {
      await ingestAssistantEvent(event)
    } catch (error) {
      console.error("[assistant-whatsapp]", error instanceof Error ? error.message : "Ingest failed.")
    }
  }

  return NextResponse.json({ ok: true })
}
