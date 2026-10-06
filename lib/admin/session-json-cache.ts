export function readSessionJsonCache<T>(
  key: string,
  ttlMs: number,
  isValid: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const fetchedAt = (parsed as { fetchedAt?: unknown }).fetchedAt
    if (typeof fetchedAt !== "number" || Date.now() - fetchedAt > ttlMs) return null
    if (!isValid(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSessionJsonCache(key: string, value: object): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...value, fetchedAt: Date.now() }))
  } catch {
    /* quota / private mode */
  }
}

export function clearSessionJsonCache(key: string): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
