import { Resend } from "resend"
import { getMarketingOutreachFromAddress, getResendApiKey } from "@/lib/email/config"

export async function sendAssistantEmailReply(input: {
  to: string
  subject: string
  text: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = getResendApiKey()
  const from = getMarketingOutreachFromAddress()
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured." }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [input.to],
    subject: input.subject,
    text: input.text,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
