import { Resend } from "resend"
import {
  fromHeaderWithName,
  getOperationsEmailCc,
  getResendApiKey,
  getResendFromAddress,
  getTicketEmailFromAddress,
  isUnverifiedResendDomainError,
  OPERATIONS_EMAIL_SENDER_NAME,
} from "@/lib/email/config"
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

  async function sendFrom(sender: string) {
    return resend.emails.send({
      from: sender,
      to: [input.to],
      ...(cc.length > 0 ? { cc } : {}),
      subject: input.subject,
      html: operationsEmailHtml(input.body),
      text: input.body,
    })
  }

  const first = await sendFrom(from)
  if (!first.error) return { ok: true }

  const fallbackRaw = getResendFromAddress()
  const fallback = fallbackRaw ? fromHeaderWithName(fallbackRaw, OPERATIONS_EMAIL_SENDER_NAME) : null
  if (fallback && fallback !== from && isUnverifiedResendDomainError(first.error.message)) {
    const retry = await sendFrom(fallback)
    if (!retry.error) return { ok: true }
    return { ok: false, error: retry.error.message }
  }

  return { ok: false, error: first.error.message }
}
