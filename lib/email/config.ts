/** Env values pasted with JSON-style wrapping break Resend (`from` must not include literal quote chars). */
export function stripSurroundingQuotes(value: string): string {
  let v = value.trim()
  while (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    v = v.slice(1, -1).trim()
  }
  return v
}

export const DEFAULT_FINANCE_CC = "finance@zk-sports.com"

/**
 * CC list for invoice and payment-reminder emails.
 * Always includes finance@zk-sports.com, plus any extra addresses in XERO_INVOICE_CC.
 */
export function getInvoiceFinanceCc(excludeEmail: string): string[] {
  const exclude = excludeEmail.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  const raw = [DEFAULT_FINANCE_CC, process.env.XERO_INVOICE_CC ?? ""].join(",")

  for (const part of raw.split(/[,;]/g)) {
    const email = stripSurroundingQuotes(part.trim())
    if (!email) continue
    const key = email.toLowerCase()
    if (key === exclude || seen.has(key)) continue
    seen.add(key)
    out.push(email)
  }

  return out
}

export function getResendFromAddress(): string | null {
  const from =
    stripSurroundingQuotes(process.env.AUTH_EMAIL_FROM?.trim() ?? "") ||
    stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "")
  return from || null
}

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null
}
