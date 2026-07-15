import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"

export type CatalogClientCache = {
  rows: AdminPackageRow[]
  races: AdminRaceOption[]
  fetchedAt: number
}

const CACHE_KEY = "zk-admin-catalog-v2"
const TTL_MS = 5 * 60 * 1000

export function readCatalogClientCache(): CatalogClientCache | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CatalogClientCache
    if (!Array.isArray(parsed.rows) || !Array.isArray(parsed.races)) return null
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCatalogClientCache(rows: AdminPackageRow[], races: AdminRaceOption[]): void {
  if (typeof window === "undefined") return
  try {
    const payload: CatalogClientCache = { rows, races, fetchedAt: Date.now() }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

export function clearCatalogClientCache(): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}
