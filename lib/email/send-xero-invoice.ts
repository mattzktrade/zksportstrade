import { Resend } from "resend"
import { getResendApiKey, getResendFromAddress, stripSurroundingQuotes } from "@/lib/email/config"
import { xeroFetchInvoicePdf } from "@/lib/integrations/xero/client"

const DEFAULT_INVOICE_CC = "finance@zk-sports.com"

export type XeroInvoiceEmailPayload = {
  agentEmail: string
  agentName: string
  orderReference: string
  xeroInvoiceId: string
  xeroInvoiceNumber: string | null
  packageName: string
  clientName: string
  guests: number
  totalAmount: number
  currency: string
  dueDate: string
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

function parseInvoiceCc(agentEmail: string): string[] {
  const raw = process.env.XERO_INVOICE_CC?.trim() || DEFAULT_INVOICE_CC
  const agentKey = agentEmail.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []

  for (const part of raw.split(/[,;]/g)) {
    const email = stripSurroundingQuotes(part.trim())
    if (!email) continue
    const key = email.toLowerCase()
    if (key === agentKey || seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }

  return out
}

function buildHtml(p: XeroInvoiceEmailPayload): string {
  const invLabel = p.xeroInvoiceNumber ? escapeHtml(p.xeroInvoiceNumber) : "attached"
  return [
    `<p>Hi ${escapeHtml(p.agentName)},</p>`,
    `<p>Please find your invoice <strong>${invLabel}</strong> attached for booking <strong>${escapeHtml(p.orderReference)}</strong>.</p>`,
    `<p><strong>${escapeHtml(p.packageName)}</strong><br/>`,
    `Client: ${escapeHtml(p.clientName)}<br/>`,
    `Guests: ${p.guests}<br/>`,
    `Amount due: ${escapeHtml(formatMoney(p.totalAmount, p.currency))}<br/>`,
    `Due date: ${escapeHtml(p.dueDate)}</p>`,
    `<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>`,
  ].join("")
}

/**
 * Email invoice PDF to the agent with finance CC (Xero's /Email API cannot CC recipients).
 */
export async function sendXeroInvoiceEmail(
  p: XeroInvoiceEmailPayload,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ORDER_EMAIL_FROM not configured" }
  }

  const cc = parseInvoiceCc(p.agentEmail)
  let pdf: ArrayBuffer
  try {
    pdf = await xeroFetchInvoicePdf(p.xeroInvoiceId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to download invoice PDF" }
  }

  const invNo = p.xeroInvoiceNumber?.trim() || p.orderReference
  const filename = `Invoice-${invNo.replace(/[^\w.-]+/g, "-")}.pdf`
  const subject = `Invoice ${invNo} — ${p.orderReference}`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [p.agentEmail],
    ...(cc.length > 0 ? { cc } : {}),
    subject,
    html: buildHtml(p),
    attachments: [
      {
        filename,
        content: Buffer.from(pdf),
      },
    ],
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
