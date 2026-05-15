const SAFE_RELATIVE_PATH = /^\/[a-zA-Z0-9/_.%-]*$/

/** Allow https URLs and same-origin relative paths (e.g. `/images/circuits/monaco.jpg`). */
export function sanitizeHttpsUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const trimmed = url.trim()

  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) return null
    if (trimmed.includes(":")) return null
    if (!SAFE_RELATIVE_PATH.test(trimmed)) return null
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "https:") return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function sanitizeHttpsUrlList(urls: string[]): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const safe = sanitizeHttpsUrl(raw)
    if (safe) out.push(safe)
  }
  return out
}
