/** Pull human-readable messages from Xero ValidationException responses. */
export function formatXeroApiErrorBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback

  const record = body as Record<string, unknown>
  const elements = Array.isArray(record.Elements) ? record.Elements : []
  const messages: string[] = []

  for (const el of elements) {
    if (!el || typeof el !== "object") continue
    const errors = (el as { ValidationErrors?: Array<{ Message?: string }> }).ValidationErrors
    if (!Array.isArray(errors)) continue
    for (const err of errors) {
      const msg = err?.Message?.trim()
      if (msg) messages.push(msg)
    }
  }

  if (messages.length === 0) return fallback
  return messages.join("; ")
}
