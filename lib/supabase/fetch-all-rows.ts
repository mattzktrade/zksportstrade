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
