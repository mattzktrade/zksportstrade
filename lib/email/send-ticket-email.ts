import { Resend } from "resend"
import { getOperationsEmailCc, getResendApiKey, getTicketEmailFromAddress } from "@/lib/email/config"
import { operationsEmailHtml } from "@/lib/operations/emails"

export async function sendTicketClientEmail(input: {
  to: string
  subject: string
  body: string
}): Promise<{ ok: true } | { ok: false; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getTicketEmailFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ticket email sender is not configured." }
  }
  const cc = getOperationsEmailCc(input.to)
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [input.to],
    ...(cc.length > 0 ? { cc } : {}),
    subject: input.subject,
    html: operationsEmailHtml(input.body),
    text: input.body,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
