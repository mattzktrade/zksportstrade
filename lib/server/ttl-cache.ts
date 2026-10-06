type Slot<T> = {
  value?: T
  expiresAt: number
  inflight: Promise<T> | null
}

const slots = new Map<string, Slot<unknown>>()

/**
 * Process-local memo for expensive admin reads. Fresh hits return immediately;
 * a miss shares one in-flight load so overlapping navigations do not stampede.
 */
export async function rememberTtl<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const existing = slots.get(key) as Slot<T> | undefined
  if (existing && existing.value !== undefined && existing.expiresAt > now) {
    return existing.value
  }
  if (existing?.inflight) return existing.inflight

  const slot: Slot<T> = existing ?? { expiresAt: 0, inflight: null }
  const inflight = load().then(
    (value) => {
      slot.value = value
      slot.expiresAt = Date.now() + Math.max(0, ttlMs)
      slot.inflight = null
      return value
    },
    (error: unknown) => {
      slot.inflight = null
      throw error
    },
  )
  slot.inflight = inflight
  slots.set(key, slot)
  return inflight
}

export const ADMIN_READ_TTL_MS = 15_000
