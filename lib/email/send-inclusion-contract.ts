import { Resend } from "resend"
import {
  DEFAULT_BOOKINGS_CC,
  DEFAULT_CHELLEY_CC,
  getResendApiKey,
  getResendFromAddress,
} from "@/lib/email/config"

type EmailResult = { ok: boolean; skipped?: string; error?: string }

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function ccFor(to: string): string[] {
  const exclude = to.trim().toLowerCase()
  return [DEFAULT_BOOKINGS_CC, DEFAULT_CHELLEY_CC].filter((email) => email.toLowerCase() !== exclude)
}

async function send(input: {
  to: string
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer }>
}): Promise<EmailResult> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured" }
  }
  const resend = new Resend(apiKey)
  const cc = ccFor(input.to)
  const { error } = await resend.emails.send({
    from,
    to: input.to,
    ...(cc.length === 1 ? { cc: cc[0] } : cc.length > 0 ? { cc } : {}),
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

function pdfAttachment(documentRef: string, pdf: Uint8Array | undefined) {
  if (!pdf) return undefined
  return [
    {
      filename: `Inclusions-${documentRef.replace(/[^\w.-]+/g, "-")}.pdf`,
      content: Buffer.from(pdf),
    },
  ]
}

export function sendInclusionContractEmail(input: {
  recipientEmail: string
  recipientName: string
  companyName: string
  documentRef: string
  title: string
  eventName: string
  signingUrl: string
  expiresAt: string
  pdf?: Uint8Array
}) {
  const expiry = new Date(input.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/London",
  })
  return send({
    to: input.recipientEmail,
    subject: `Please sign: ${input.title}`,
    html: [
      `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
      `<p>Please review and sign the booking inclusions for <strong>${escapeHtml(input.companyName)}</strong>.</p>`,
      `<p><strong>${escapeHtml(input.eventName || input.title)}</strong><br/>`,
      `Reference: ${escapeHtml(input.documentRef)}</p>`,
      `<p><a href="${escapeHtml(input.signingUrl)}" style="display:inline-block;background:#F90202;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:700">Review and sign</a></p>`,
      `<p>This secure link expires on ${escapeHtml(expiry)} UK time. A PDF copy is attached.</p>`,
      "<p>If you were not expecting this email, please contact ZK Sports directly and do not forward the signing link.</p>",
      "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
    ].join(""),
    attachments: pdfAttachment(input.documentRef, input.pdf),
  })
}

export function sendInclusionContractSignedEmail(input: {
  recipientEmail: string
  recipientName: string
  companyName: string
  documentRef: string
  title: string
  pdf: Uint8Array
}) {
  return send({
    to: input.recipientEmail,
    subject: `Signed booking inclusions — ${input.documentRef}`,
    html: [
      `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
      `<p>Thank you. The booking inclusions for <strong>${escapeHtml(input.companyName)}</strong> are now signed.</p>`,
      `<p>${escapeHtml(input.title)}<br/>Reference: ${escapeHtml(input.documentRef)}</p>`,
      "<p>The signed copy is attached.</p>",
      "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
    ].join(""),
    attachments: pdfAttachment(input.documentRef, input.pdf),
  })
}
