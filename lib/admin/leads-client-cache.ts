import type { AdminRaceOption } from "@/lib/admin/queries"
import {
  clearSessionJsonCache,
  readSessionJsonCache,
  writeSessionJsonCache,
} from "@/lib/admin/session-json-cache"
import type { ClientDirectoryRow, StaffOption } from "@/lib/crm/lead-types"

export type LeadsClientCache = {
  clients: ClientDirectoryRow[]
  staffOptions: StaffOption[]
  races: AdminRaceOption[]
  fetchedAt: number
}

const CACHE_KEY = "zk-admin-leads-directory-v1"
const TTL_MS = 5 * 60 * 1000

function isCache(value: unknown): value is LeadsClientCache {
  if (!value || typeof value !== "object") return false
  const parsed = value as LeadsClientCache
  return (
    Array.isArray(parsed.clients) &&
    Array.isArray(parsed.staffOptions) &&
    Array.isArray(parsed.races)
  )
}

export function readLeadsClientCache(): LeadsClientCache | null {
  return readSessionJsonCache(CACHE_KEY, TTL_MS, isCache)
}

export function writeLeadsClientCache(
  clients: ClientDirectoryRow[],
  staffOptions: StaffOption[],
  races: AdminRaceOption[],
): void {
  writeSessionJsonCache(CACHE_KEY, { clients, staffOptions, races })
}

export function clearLeadsClientCache(): void {
  clearSessionJsonCache(CACHE_KEY)
}
