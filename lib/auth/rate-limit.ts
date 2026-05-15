type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** In-memory limiter (per server instance). Returns false when over limit. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = buckets.get(key)

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false

  entry.count += 1
  return true
}
