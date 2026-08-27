/** Smallest query we will send to the database. One letter is too noisy. */
export const ADMIN_SEARCH_MIN_QUERY = 2

export function sanitizeSearchQuery(query: string): string {
  return query
    .trim()
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

export function likeContains(query: string): string {
  return `%${sanitizeSearchQuery(query)}%`
}

export function likePrefix(query: string): string {
  return `${sanitizeSearchQuery(query)}%`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Higher is better. Prefix beats a match in the middle of another word, so
 * typing "eng" ranks "Engage" above "Cheng" or "Challenge".
 */
export function searchMatchScore(haystack: string, query: string): number {
  const h = haystack.trim().toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q || !h) return 0
  if (h === q) return 1000
  if (h.startsWith(q)) return 800
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(q)}`)
  if (boundary.test(h)) return 500
  if (h.includes(q)) return 100
  return 0
}

export function rankBySearchScore<T>(
  items: T[],
  query: string,
  text: (item: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return items
  return items
    .map((item, index) => ({ item, index, score: searchMatchScore(text(item), q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item)
}
