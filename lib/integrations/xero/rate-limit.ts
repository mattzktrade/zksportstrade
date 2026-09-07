/** Xero allows 60 API calls per minute per tenant and returns HTTP 429 when exceeded. */

export const XERO_RATE_LIMIT_COOLDOWN_KEY = "xero_rate_limit_cooldown_until"
export const XERO_INLINE_MAX_ATTEMPTS = 3
export const XERO_MAX_INLINE_WAIT_MS = 2500
export const XERO_MIN_COOLDOWN_MS = 20_000
export const XERO_DEFAULT_COOLDOWN_MS = 60_000
export const XERO_MAX_COOLDOWN_MS = 120_000
export const XERO_RATE_LIMIT_USER_MESSAGE =
  "Xero is temporarily rate-limiting requests. This invoice will retry automatically."

export function isRetryableXeroStatus(status: number): boolean {
  return status === 429 || status === 503
}

export function isXeroRateLimitMessage(message: string): boolean {
  return /too many requests|\b429\b|temporarily rate-limiting/i.test(message)
}

export function isXeroRateLimitError(e: unknown): boolean {
  if (typeof e === "string") return isXeroRateLimitMessage(e)
  if (e && typeof e === "object" && "status" in e && Number((e as { status: unknown }).status) === 429) {
    return true
  }
  const msg = e instanceof Error ? e.message : String(e)
  return isXeroRateLimitMessage(msg)
}

/** Retry-After is seconds or an HTTP date. */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header?.trim()) return null
  const trimmed = header.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Math.round(Number(trimmed) * 1000)
    return Number.isFinite(ms) && ms >= 0 ? ms : null
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return null
  return Math.max(0, dateMs - now)
}

export function cooldownMsFromRetryAfter(retryAfterMs?: number | null): number {
  const ms = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : XERO_DEFAULT_COOLDOWN_MS
  return Math.min(XERO_MAX_COOLDOWN_MS, Math.max(XERO_MIN_COOLDOWN_MS, ms))
}

export function decideXeroInlineRetry(input: {
  tryIndex: number
  status: number
  retryAfterHeader?: string | null
}): { retry: boolean; waitMs: number } {
  if (!isRetryableXeroStatus(input.status)) return { retry: false, waitMs: 0 }
  const parsed = parseRetryAfterMs(input.retryAfterHeader)
  const backoff = Math.min(XERO_MAX_INLINE_WAIT_MS, 400 * 2 ** input.tryIndex)
  const waitMs = Math.min(XERO_MAX_INLINE_WAIT_MS, Math.max(parsed ?? 0, backoff))
  if (input.tryIndex >= XERO_INLINE_MAX_ATTEMPTS - 1) {
    return { retry: false, waitMs: parsed ?? XERO_DEFAULT_COOLDOWN_MS }
  }
  if ((parsed ?? 0) > XERO_MAX_INLINE_WAIT_MS) {
    return { retry: false, waitMs: parsed ?? XERO_DEFAULT_COOLDOWN_MS }
  }
  return { retry: true, waitMs }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
