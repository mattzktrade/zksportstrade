/** PostgREST/Supabase silently caps a single request at this many rows. */
export const SUPABASE_PAGE_SIZE = 1000

const MAX_PAGES = 100

export type FetchPageError = {
  message: string
  code?: string
} | null

/**
 * Walk Range pages until a short page (or an unsatisfiable range).
 * Callers must apply `.range(from, to)` and a stable `.order(...)`.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null
    error: FetchPageError
  }>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<{ data: T[]; error: FetchPageError }> {
  if (pageSize < 1) {
    return { data: [], error: { message: "pageSize must be at least 1" } }
  }

  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) {
      if (rows.length > 0 && error.code === "PGRST103") break
      return { data: rows, error }
    }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return { data: rows, error: null }
}

export function chunkList<T>(items: T[], size = 200): T[][] {
  if (size < 1) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** PostgREST `.in()` filters on GET blow up past ~80 UUIDs and return `fetch failed`. */
export const POSTGREST_IN_FILTER_SIZE = 80
export const POSTGREST_CHUNK_CONCURRENCY = 2

const TRANSIENT_FETCH = /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up|network/i

export function isTransientPostgrestError(error: { message?: string } | null | undefined): boolean {
  return Boolean(error?.message && TRANSIENT_FETCH.test(error.message))
}

let activeRequests = 0
const requestWaiters: Array<() => void> = []
const MAX_CONCURRENT_REQUESTS = 6

/** Share one process-wide cap so overlapping admin pages cannot stampede PostgREST. */
export async function withRequestGate<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve))
  }
  activeRequests += 1
  try {
    return await run()
  } finally {
    activeRequests -= 1
    requestWaiters.shift()?.()
  }
}

export async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Walk id/filter chunks a few at a time instead of one PostgREST round-trip after another. */
export async function mapChunks<T, R>(
  items: readonly T[],
  size: number,
  mapper: (chunk: T[], index: number) => Promise<R>,
  concurrency = POSTGREST_CHUNK_CONCURRENCY,
): Promise<R[]> {
  const chunks = chunkList([...items], size)
  const results: R[] = new Array(chunks.length)
  const limit = Math.max(1, concurrency)
  for (let i = 0; i < chunks.length; i += limit) {
    const batch = chunks.slice(i, i + limit)
    const batchResults = await Promise.all(
      batch.map((chunk, offset) => withRequestGate(() => mapper(chunk, i + offset))),
    )
    for (let offset = 0; offset < batchResults.length; offset += 1) {
      results[i + offset] = batchResults[offset]
    }
  }
  return results
}
