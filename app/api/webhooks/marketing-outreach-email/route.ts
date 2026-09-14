import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { suggestedEnquiryAction } from "@/lib/crm/deal-pipeline"
import { isOutreachStopKeyword } from "@/lib/integrations/marketing-leads/outreach-labels"
import { findActiveOutreachByEmail } from "@/lib/integrations/marketing-leads/outreach-store"
import { stopMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-stop"
import { safeEqualStrings } from "@/lib/crypto/timing-safe"

function secretFromRequest(request: Request): string {
  return (
    request.headers.get("x-webhook-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  )
}

export async function POST(request: Request) {
  const expected = process.env.MARKETING_OUTREACH_EMAIL_WEBHOOK_SECRET?.trim()
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

  const email = extractReplyEmail(body)
  const text = extractReplyText(body)
  if (!email) return NextResponse.json({ ok: true, ignored: true })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: true, skipped: true })
  const enrollment = await findActiveOutreachByEmail(admin, email)
  if (!enrollment) return NextResponse.json({ ok: true, unmatched: true })

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
  return NextResponse.json({ ok: true })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function extractReplyEmail(body: unknown): string | null {
  const root = asRecord(body)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  const from =
    (typeof data.from === "string" && data.from) ||
    (typeof asRecord(data.from)?.email === "string" && String(asRecord(data.from)?.email)) ||
    (typeof data.sender === "string" && data.sender) ||
    ""
  const match = from.toLowerCase().match(/[^\s<>]+@[^\s<>]+/)
  return match?.[0] ?? null
}

function extractReplyText(body: unknown): string {
  const root = asRecord(body)
  if (!root) return ""
  const data = asRecord(root.data) ?? root
  for (const key of ["text", "plain", "stripped_text", "body", "subject"]) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return ""
}
