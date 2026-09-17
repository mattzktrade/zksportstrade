export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_CLIENT_CC_EMAILS = 8

export type BookingFormAccountEmailOption = {
  email: string
  label: string
}

export function splitCcInput(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((value) => value.replaceAll("\u0000", "").trim())
    .filter(Boolean)
}

function collectCcEmails(
  raw: unknown,
  signerEmail: string,
  strict: boolean,
): string[] {
  const signer = signerEmail.trim().toLowerCase()
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? splitCcInput(raw) : []
  const seen = new Set<string>()
  const emails: string[] = []
  for (const value of values) {
    if (typeof value !== "string") {
      if (strict) throw new Error("Enter a valid CC email address.")
      continue
    }
    const email = value.replaceAll("\u0000", "").trim().toLowerCase()
    if (!email || email === signer || seen.has(email)) continue
    if (!EMAIL_RE.test(email) || email.length > 240) {
      if (strict) {
        throw new Error(
          EMAIL_RE.test(email) ? "A CC email is too long." : `Enter a valid CC email address (${email}).`,
        )
      }
      continue
    }
    seen.add(email)
    emails.push(email)
    if (emails.length > MAX_CLIENT_CC_EMAILS) {
      if (strict) {
        throw new Error(`You can CC at most ${MAX_CLIENT_CC_EMAILS} extra addresses.`)
      }
      emails.pop()
      break
    }
  }
  return emails
}

export function normalizeClientCcEmails(raw: unknown, signerEmail: string): string[] {
  return collectCcEmails(raw, signerEmail, true)
}

export function snapshotClientCcEmails(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object") return []
  const data = snapshot as { ccEmails?: unknown; billTo?: { contactEmail?: unknown } }
  const signer = typeof data.billTo?.contactEmail === "string" ? data.billTo.contactEmail : ""
  return collectCcEmails(data.ccEmails, signer, false)
}
