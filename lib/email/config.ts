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
export const DEFAULT_BOOKINGS_CC = "bookings@zk-sports.com"
export const DEFAULT_CHELLEY_CC = "chelley@zk-sports.com"
export const DEFAULT_OPERATIONS_CC = "jenny@zk-sports.com"
export const OPERATIONS_EMAIL_SENDER_NAME = "Jenny Kent"

/** Never CC these, even if a leftover Vercel env var still lists them. */
export const NEVER_CC_ADDRESSES = new Set(["matt@zk-sports.com"])

function exclusiveCc(address: string, excludeEmail: string): string[] {
  const email = address.trim()
  if (!email) return []
  const lower = email.toLowerCase()
  if (lower === excludeEmail.trim().toLowerCase()) return []
  if (NEVER_CC_ADDRESSES.has(lower)) return []
  return [email]
}

/** CC for portal booking confirmations: bookings@ only. Ignores ORDER_CONFIRMATION_CC. */
export function getBookingConfirmationCc(excludeEmail: string): string[] {
  return exclusiveCc(DEFAULT_BOOKINGS_CC, excludeEmail)
}

/**
 * CC for invoice and payment-reminder emails: finance@ only.
 * Ignores Vercel leftovers such as XERO_INVOICE_CC so they cannot put matt@ on invoice mail.
 */
export function getInvoiceFinanceCc(excludeEmail: string): string[] {
  return exclusiveCc(DEFAULT_FINANCE_CC, excludeEmail)
}

/** CC for operations introduction and guest-details emails: jenny@ only. */
export function getOperationsEmailCc(excludeEmail: string): string[] {
  return exclusiveCc(DEFAULT_OPERATIONS_CC, excludeEmail)
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
