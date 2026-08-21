"use client"

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

function mergeSaved<T extends Record<string, unknown>>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...defaults }
  const record = saved as Record<string, unknown>
  const next = { ...defaults }
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    if (!Object.prototype.hasOwnProperty.call(record, key as string)) continue
    const current = defaults[key]
    const incoming = record[key as string]
    if (Array.isArray(current)) {
      if (Array.isArray(incoming)) next[key] = incoming as T[keyof T]
      continue
    }
    if (current !== null && typeof current === "object") continue
    if (typeof incoming === typeof current && incoming !== null) {
      next[key] = incoming as T[keyof T]
    }
  }
  return next
}

/**
 * Restores admin list filters from localStorage after mount so refresh and
 * in-app back navigation keep the last search, dropdowns, and sort.
 */
export function usePersistedAdminFilters<T extends Record<string, unknown>>(
  storageKey: string,
  defaults: T,
  options?: { override?: Partial<T> | null },
): [T, Dispatch<SetStateAction<T>>] {
  const defaultsRef = useRef(defaults)
  const overrideRef = useRef(options?.override)
  overrideRef.current = options?.override

  const [value, setValue] = useState<T>(defaults)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let next = { ...defaultsRef.current }
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) next = mergeSaved(defaultsRef.current, JSON.parse(raw))
    } catch {
      /* ignore quota / parse errors */
    }
    const override = overrideRef.current
    if (override) next = { ...next, ...override }
    setValue(next)
    setReady(true)
  }, [storageKey])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* ignore quota */
    }
  }, [ready, storageKey, value])

  return [value, setValue]
}
