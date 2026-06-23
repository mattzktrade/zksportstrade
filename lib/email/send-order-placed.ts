import { Resend } from "resend"

export type OrderEmailPayload = {
  agentEmail: string
  agentName: string
  orderReference: string
  packageName: string
  circuit: string
  guests: number
  totalAmount: number
  currency: string
  clientName: string
  clientEmail: string
  clientPhone: string
  clientNationality: string
  poNumber: string | null
  dietary: string | null
  specialRequests: string | null
  shippingAddressLine1: string
  shippingAddressLine2: string
  shippingCity: string
  shippingPostcode: string
  shippingCountry: string
  billingAddressLine1: string
  billingAddressLine2: string
  billingCity: string
  billingPostcode: string
  billingCountry: string
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

function labeledField(label: string, value: string): string {
  const v = value.trim()
  if (!v) return ""
  return `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(v)}`
}

function buildHtml(p: OrderEmailPayload): string {
  const clientLines = [
    labeledField("Full name", p.clientName),
    labeledField("Email", p.clientEmail),
    labeledField("Phone", p.clientPhone),
    p.clientNationality.trim() ? labeledField("Nationality", p.clientNationality) : "",
  ].filter(Boolean)

  const lines = [
    `<p>Hi ${escapeHtml(p.agentName)},</p>`,
    `<p>Please see below confirmation of your booking. Our finance team will be in touch regarding payment separately.</p>`,
    `<p><strong>Booking reference:</strong> ${escapeHtml(p.orderReference)}</p>`,
    `<p><strong>Experience</strong><br/>`,
    `${labeledField("Package", `${p.packageName} — ${p.circuit}`)}<br/>`,
    `${labeledField("Guests", String(p.guests))}<br/>`,
    `${labeledField("Total", formatMoney(p.totalAmount, p.currency))}`,
    `</p>`,
    `<p><strong>Client / lead guest</strong><br/>`,
    clientLines.join("<br/>"),
    `</p>`,
  ]

  const shipLines = [
    p.shippingAddressLine1,
    p.shippingAddressLine2,
    [p.shippingCity, p.shippingPostcode].filter(Boolean).join(", "),
    p.shippingCountry,
  ].filter((s) => s.length > 0)
  if (shipLines.length > 0) {
    lines.push(
      `<p><strong>Shipping address</strong><br/>${shipLines.map((s) => escapeHtml(s)).join("<br/>")}</p>`,
    )
  }

  const billLines = [
    p.billingAddressLine1,
    p.billingAddressLine2,
    [p.billingCity, p.billingPostcode].filter(Boolean).join(", "),
    p.billingCountry,
  ].filter((s) => s.length > 0)
  if (billLines.length > 0) {
    lines.push(
      `<p><strong>Billing address</strong><br/>${billLines.map((s) => escapeHtml(s)).join("<br/>")}</p>`,
    )
  }

  if (p.poNumber) lines.push(`<p><strong>PO number:</strong> ${escapeHtml(p.poNumber)}</p>`)
  if (p.dietary) lines.push(`<p><strong>Dietary:</strong> ${escapeHtml(p.dietary)}</p>`)
  if (p.specialRequests) lines.push(`<p><strong>Special requests:</strong> ${escapeHtml(p.specialRequests)}</p>`)

  lines.push(`<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>`)

  return lines.join("")
}

import { stripSurroundingQuotes } from "@/lib/email/config"

/** Legacy inbox — no longer CC'd on confirmations (use ORDER_CONFIRMATION_CC / FINANCE_NOTIFICATION_EMAILS). */
const BLOCKED_CONFIRMATION_CC = new Set(["bookings@zk-sports.com"])

function parseConfirmationCc(): string[] {
  const raw = [
    process.env.FINANCE_NOTIFICATION_EMAILS ?? "",
    process.env.FINANCE_TEAM_EMAIL ?? "",
    process.env.ORDER_CONFIRMATION_CC ?? "",
  ].join(",")

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;]/g)) {
    const email = stripSurroundingQuotes(part.trim())
    if (!email) continue
    const key = email.toLowerCase()
    if (BLOCKED_CONFIRMATION_CC.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }
  return out
}

export async function sendOrderPlacedEmail(p: OrderEmailPayload): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "") ||
    stripSurroundingQuotes(process.env.AUTH_EMAIL_FROM?.trim() ?? "")
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or ORDER_EMAIL_FROM not configured" }
  }

  const cc = parseConfirmationCc()
  const resend = new Resend(apiKey)
  const subject = `Booking Confirmation ${p.orderReference} — ${p.circuit}`

  let body = buildHtml(p)
  if (cc.length === 0) {
    body +=
      "<p><strong>Note:</strong> Finance notification emails are not configured on the server yet. Please forward this confirmation internally.</p>"
  }

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
