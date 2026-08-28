import { Resend } from "resend"
import { getOperationsEmailCc, getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { operationsEmailHtml } from "@/lib/operations/emails"

export async function sendOperationsClientEmail(input: {
  to: string
  subject: string
  body: string
}): Promise<{ ok: true } | { ok: false; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured." }
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
