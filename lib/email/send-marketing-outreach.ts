import { Resend } from "resend"
import { NEVER_CC_ADDRESSES, getResendApiKey, getResendFromAddress, stripSurroundingQuotes } from "@/lib/email/config"
import { outreachPlainTextToHtml } from "@/lib/integrations/marketing-leads/outreach-render"

export type MarketingOutreachEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped?: string; error?: string }

function marketingFromAddress(): string | null {
  const dedicated = stripSurroundingQuotes(process.env.MARKETING_OUTREACH_FROM?.trim() ?? "")
  return dedicated || getResendFromAddress()
}

export async function sendMarketingOutreachEmail(input: {
  to: string
  subject: string
  text: string
}): Promise<MarketingOutreachEmailResult> {
  const apiKey = getResendApiKey()
  const from = marketingFromAddress()
  const to = input.to.trim()
  if (!apiKey || !from) {
    return { ok: false, skipped: "email_not_configured" }
  }
  if (!to || !to.includes("@")) {
    return { ok: false, skipped: "no_email" }
  }

  const replyTo = stripSurroundingQuotes(process.env.MARKETING_OUTREACH_REPLY_TO?.trim() ?? "")
  const bccRaw = stripSurroundingQuotes(process.env.MARKETING_OUTREACH_BCC?.trim() ?? "")
  const bcc =
    bccRaw &&
    bccRaw.toLowerCase() !== to.toLowerCase() &&
    !NEVER_CC_ADDRESSES.has(bccRaw.toLowerCase())
      ? [bccRaw]
      : []

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    ...(replyTo ? { replyTo } : {}),
    ...(bcc.length > 0 ? { bcc } : {}),
    subject: input.subject.trim() || "Your ZK Sports enquiry",
    text: input.text,
    html: outreachPlainTextToHtml(input.text),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data?.id ?? null }
}
