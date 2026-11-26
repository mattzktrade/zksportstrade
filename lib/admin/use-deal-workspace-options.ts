"use client"

import { useEffect, useState } from "react"
import { loadDealWorkspaceOptionsAction } from "@/app/(admin)/admin/deals/deal-workspace-options-actions"
import {
  EMPTY_DEAL_WORKSPACE_OPTIONS,
  type DealWorkspaceOptions,
} from "@/lib/crm/deal-workspace-options"

let cached: DealWorkspaceOptions | null = null
let cachedAt = 0
let inflight: Promise<DealWorkspaceOptions | null> | null = null
const CLIENT_TTL_MS = 30_000

async function fetchDealWorkspaceOptions(): Promise<DealWorkspaceOptions | null> {
  if (cached && Date.now() - cachedAt < CLIENT_TTL_MS) return cached
  if (inflight) return inflight
  inflight = loadDealWorkspaceOptionsAction()
    .then((result) => {
      inflight = null
      if (!result.ok) return cached
      cached = result.options
      cachedAt = Date.now()
      return cached
    })
    .catch(() => {
      inflight = null
      return cached
    })
  return inflight
}

export function useDealWorkspaceOptions(): DealWorkspaceOptions & { optionsLoaded: boolean } {
  const [options, setOptions] = useState<DealWorkspaceOptions>(cached ?? EMPTY_DEAL_WORKSPACE_OPTIONS)
  const [optionsLoaded, setOptionsLoaded] = useState(cached != null)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let retryTimer = 0
    const load = () => {
      void fetchDealWorkspaceOptions().then((next) => {
        if (cancelled) return
        if (next) {
          setOptions(next)
          setOptionsLoaded(true)
          return
        }
        attempts += 1
        if (attempts < 3) {
          retryTimer = window.setTimeout(load, 700 * attempts)
          return
        }
        setOptionsLoaded(true)
      })
    }
    load()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [])

  return { ...options, optionsLoaded }
}
