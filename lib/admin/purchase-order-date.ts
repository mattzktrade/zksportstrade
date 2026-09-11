const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse an optional calendar date from a form field. Empty becomes null. */
export function parseOptionalIsoDate(
  value: string | null | undefined,
  label: string,
): { ok: true; date: string | null } | { ok: false; message: string } {
  const t = String(value ?? "").trim()
  if (!t) return { ok: true, date: null }
  if (!ISO_DATE_RE.test(t)) {
    return { ok: false, message: `${label} must be YYYY-MM-DD.` }
  }
  return { ok: true, date: t }
}
