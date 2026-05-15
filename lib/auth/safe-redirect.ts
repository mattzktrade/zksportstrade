/** Same-origin relative paths only — blocks open redirects (e.g. `//evil.com`). */
const SAFE_PATH = /^\/[a-zA-Z0-9/_.%-]*$/

export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (!input) return fallback
  const path = input.trim()
  if (!path.startsWith("/")) return fallback
  if (path.startsWith("//")) return fallback
  if (path.includes("\\")) return fallback
  if (path.includes(":")) return fallback
  if (!SAFE_PATH.test(path)) return fallback
  return path
}

/** Resolve a safe path against the request origin; returns fallback path on mismatch. */
export function safeRedirectUrl(path: string | null | undefined, origin: string, fallback = "/"): URL {
  const safePath = safeRedirectPath(path, fallback)
  const base = new URL(origin)
  const target = new URL(safePath, base)
  if (target.origin !== base.origin) {
    return new URL(fallback, base)
  }
  return target
}
