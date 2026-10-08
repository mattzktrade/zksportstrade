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

export const DEFAULT_MARKETING_OUTREACH_FROM = "ZK Sports <sales@zk-sports.com>"
export const DEFAULT_FINANCE_CC = "finance@zk-sports.com"
export const DEFAULT_BOOKINGS_CC = "bookings@zk-sports.com"
export const DEFAULT_CHELLEY_CC = "chelley@zk-sports.com"
export const DEFAULT_OPERATIONS_CC = "jenny@zk-sports.com"
export const OPERATIONS_EMAIL_SENDER_NAME = "Jenny Kent"
/** Fallback only if AUTH/ORDER from-address is missing. Must be a Resend-verified domain. */
export const DEFAULT_TICKET_EMAIL_FROM = "Jenny Kent <confirmation@zk-sports.trade>"

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

/** CC for invoice and payment-reminder emails: finance@ only.
 * Ignores Vercel leftovers such as XERO_INVOICE_CC so they cannot put matt@ on invoice mail.
 */
export function getInvoiceFinanceCc(excludeEmail: string): string[] {
  return exclusiveCc(DEFAULT_FINANCE_CC, excludeEmail)
}

export function invoiceEmailCc(to: string, extraCc: string[] = []): string[] {
  const finance = getInvoiceFinanceCc(to)
  const exclude = new Set(
    [to, ...finance].map((email) => email.trim().toLowerCase()).filter(Boolean),
  )
  const extras: string[] = []
  const seen = new Set<string>()
  for (const raw of extraCc) {
    const email = raw.trim().toLowerCase()
    if (!email.includes("@") || exclude.has(email) || seen.has(email)) continue
    seen.add(email)
    extras.push(email)
  }
  return [...extras, ...finance]
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

export function mailboxFromFromHeader(from: string | null | undefined): string | null {
  const trimmed = stripSurroundingQuotes(from ?? "")
  if (!trimmed) return null
  const angled = trimmed.match(/<([^>]+)>/)
  const email = (angled?.[1] ?? trimmed).trim()
  return email.includes("@") ? email : null
}

export function fromHeaderWithName(from: string, name: string): string {
  const email = mailboxFromFromHeader(from)
  return email ? `${name} <${email}>` : stripSurroundingQuotes(from)
}

export function isUnverifiedResendDomainError(message: string | null | undefined): boolean {
  return /domain is not verified/i.test(message ?? "")
}

/** Ticket delivery mail. Jenny's name on the connected Resend mailbox (zk-sports.trade). */
export function getTicketEmailFromAddress(): string | null {
  const explicit = stripSurroundingQuotes(process.env.TICKET_EMAIL_FROM?.trim() ?? "")
  if (explicit) return explicit
  const connected = getResendFromAddress()
  if (connected) return fromHeaderWithName(connected, OPERATIONS_EMAIL_SENDER_NAME)
  if (getResendApiKey()) return DEFAULT_TICKET_EMAIL_FROM
  return null
}
