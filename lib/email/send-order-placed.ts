import { Resend } from "resend"

export type OrderEmailPayload = {
  agentEmail: string
  agentName: string
  orderReference: string
  invoiceReference: string
  packageName: string
  circuit: string
  guests: number
  totalAmount: number
  currency: string
  clientName: string
  clientEmail: string
  clientPhone: string
  clientCompany: string
  poNumber: string | null
  dietary: string | null
  specialRequests: string | null
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

function buildHtml(p: OrderEmailPayload): string {
  const lines = [
    `<p>Hi ${escapeHtml(p.agentName)},</p>`,
    `<p>Your booking request has been recorded in the trade portal.</p>`,
    `<p><strong>Order reference:</strong> ${escapeHtml(p.orderReference)}<br/>`,
    `<strong>Invoice reference (pending):</strong> ${escapeHtml(p.invoiceReference)}</p>`,
    `<p><strong>Experience</strong><br/>${escapeHtml(p.packageName)} — ${escapeHtml(p.circuit)}<br/>`,
    `Guests: ${p.guests}<br/>`,
    `Total (trade): ${escapeHtml(formatMoney(p.totalAmount, p.currency))}</p>`,
    `<p><strong>Client / lead guest</strong><br/>`,
    `${escapeHtml(p.clientName)}<br/>`,
    `${escapeHtml(p.clientEmail)}<br/>`,
    `${escapeHtml(p.clientPhone)}`,
    p.clientCompany ? `<br/>${escapeHtml(p.clientCompany)}` : "",
    "</p>",
  ]

  if (p.poNumber) lines.push(`<p><strong>PO number:</strong> ${escapeHtml(p.poNumber)}</p>`)
  if (p.dietary) lines.push(`<p><strong>Dietary:</strong> ${escapeHtml(p.dietary)}</p>`)
  if (p.specialRequests) lines.push(`<p><strong>Special requests:</strong> ${escapeHtml(p.specialRequests)}</p>`)

  lines.push(
    `<p>Our finance team has been copied on this message. They will record the opportunity in Salesforce and send your client a formal invoice with payment terms.</p>`,
    `<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>`,
  )

  return lines.join("")
}

/** Env values pasted with JSON-style wrapping break Resend (`from` must not include literal quote chars). */
function stripSurroundingQuotes(value: string): string {
  let v = value.trim()
  while (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim()
  }
  return v
}

function parseFinanceCc(): string[] {
  const raw = process.env.FINANCE_NOTIFICATION_EMAILS ?? process.env.FINANCE_TEAM_EMAIL ?? ""
  return raw
    .split(/[,;]/g)
    .map((s) => stripSurroundingQuotes(s.trim()))
    .filter((s) => s.length > 0)
}

export async function sendOrderPlacedEmail(p: OrderEmailPayload): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "")
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ORDER_EMAIL_FROM not configured" }
  }

  const cc = parseFinanceCc()
  const resend = new Resend(apiKey)
  const subject = `New portal order ${p.orderReference} — ${p.circuit}`

  const financeNote =
    cc.length === 0
      ? "<p><strong>Note:</strong> Finance notification emails are not configured on the server yet. Please forward this confirmation internally.</p>"
      : "<p>Our finance team has been copied on this message. They will record the opportunity in Salesforce and send your client a formal invoice with payment terms.</p>"

  const body =
    buildHtml(p).replace(
      "<p>Our finance team has been copied on this message. They will record the opportunity in Salesforce and send your client a formal invoice with payment terms.</p>",
      financeNote,
    )

  const { error } = await resend.emails.send({
    from,
    to: [p.agentEmail],
    ...(cc.length > 0 ? { cc } : {}),
    subject,
    html: body,
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  if (cc.length === 0) {
    console.warn("[email] FINANCE_NOTIFICATION_EMAILS is empty — agent was emailed without finance CC")
  }
  return { ok: true }
}
