const NESTED_ERROR_KEYS = ["Elements", "LineItems", "Invoices", "Contacts", "Items"] as const

function collectValidationMessages(value: unknown, into: string[]): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) collectValidationMessages(item, into)
    return
  }

  const record = value as Record<string, unknown>
  const errors = record.ValidationErrors
  if (Array.isArray(errors)) {
    for (const err of errors) {
      if (!err || typeof err !== "object") continue
      const msg = (err as { Message?: string }).Message?.trim()
      if (msg) into.push(msg)
    }
  }

  for (const key of NESTED_ERROR_KEYS) {
    if (key in record) collectValidationMessages(record[key], into)
  }
}

/** Pull human-readable messages from Xero ValidationException responses, including nested line items. */
export function formatXeroApiErrorBody(body: unknown, fallback: string): string {
  if (typeof body === "string") {
    const trimmed = body.trim()
    if (!trimmed) return fallback
    if (/<html/i.test(trimmed)) return fallback
    return trimmed.slice(0, 500)
  }
  if (!body || typeof body !== "object") return fallback

  const messages: string[] = []
  collectValidationMessages(body, messages)
  if (messages.length === 0) return fallback

  return [...new Set(messages)].join("; ")
}
