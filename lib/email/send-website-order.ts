import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { ADGP_NOTIFY_EMAILS } from "@/lib/integrations/adgp/config"

export type WebsiteOrderEmailPayload = {
  orderReference: string
  dealReference: string
  packageName: string
  guests: number
  totalAmount: number
  currency: string
  clientName: string
  clientEmail: string
  clientPhone: string
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function websiteOrderNotifyRecipients(): string[] {
  return [...ADGP_NOTIFY_EMAILS]
}

export async function sendWebsiteOrderEmail(
  p: WebsiteOrderEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured." }
  }

  const to = websiteOrderNotifyRecipients()
  const resend = new Resend(apiKey)
  const subject = `Website booking ${p.orderReference} — ${p.packageName}`
  const html = [
    `<p>A customer paid on the Abu Dhabi GP website.</p>`,
    `<p><strong>Order:</strong> ${escapeHtml(p.orderReference)}<br/>`,
    `<strong>Deal:</strong> ${escapeHtml(p.dealReference)}<br/>`,
    `<strong>Package:</strong> ${escapeHtml(p.packageName)}<br/>`,
    `<strong>Guests:</strong> ${p.guests}<br/>`,
    `<strong>Total:</strong> ${escapeHtml(formatMoney(p.totalAmount, p.currency))}</p>`,
    `<p><strong>Client</strong><br/>`,
    `${escapeHtml(p.clientName)}<br/>`,
    `${escapeHtml(p.clientEmail)}<br/>`,
    `${escapeHtml(p.clientPhone || "—")}</p>`,
    `<p>Source is Website. Owner is Matt. The deal is marked paid.</p>`,
  ].join("")

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}
