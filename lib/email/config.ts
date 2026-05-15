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

export function getResendFromAddress(): string | null {
  const from =
    stripSurroundingQuotes(process.env.AUTH_EMAIL_FROM?.trim() ?? "") ||
    stripSurroundingQuotes(process.env.ORDER_EMAIL_FROM?.trim() ?? "")
  return from || null
}

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null
}
