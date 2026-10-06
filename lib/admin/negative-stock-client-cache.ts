import {
  clearSessionJsonCache,
  readSessionJsonCache,
  writeSessionJsonCache,
} from "@/lib/admin/session-json-cache"
import type { NegativeStockRow } from "@/lib/admin/negative-stock"

export type NegativeStockClientCache = {
  rows: NegativeStockRow[]
  fetchedAt: number
}

const CACHE_KEY = "zk-admin-negative-stock-v1"
const TTL_MS = 2 * 60 * 1000

function isCache(value: unknown): value is NegativeStockClientCache {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as NegativeStockClientCache).rows),
  )
}

export function readNegativeStockClientCache(): NegativeStockClientCache | null {
  return readSessionJsonCache(CACHE_KEY, TTL_MS, isCache)
}

export function writeNegativeStockClientCache(rows: NegativeStockRow[]): void {
  writeSessionJsonCache(CACHE_KEY, { rows })
}

export function clearNegativeStockClientCache(): void {
  clearSessionJsonCache(CACHE_KEY)
}
