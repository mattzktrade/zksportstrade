"use client"

import { useCallback, useLayoutEffect, useState } from "react"

export const ADMIN_DESKTOP_SPLIT_MQ = "(min-width: 1280px)"

/**
 * List-row previews stay closed until the user selects a row.
 * A deep-linked `initialId` still opens that record.
 */
export function useAdminListSelection(options?: {
  initialId?: string | null
}) {
  const initialId = options?.initialId ?? null
  const [isDesktop, setIsDesktop] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const [mobileOpen, setMobileOpen] = useState(Boolean(initialId))

  useLayoutEffect(() => {
    const mq = window.matchMedia(ADMIN_DESKTOP_SPLIT_MQ)
    function sync() {
      setIsDesktop(mq.matches)
    }
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  useLayoutEffect(() => {
    if (!initialId) return
    setSelectedId(initialId)
    setMobileOpen(true)
  }, [initialId])

  const selectRow = useCallback((id: string) => {
    setSelectedId(id)
    setMobileOpen(true)
  }, [])

  const closePreview = useCallback(() => {
    setMobileOpen(false)
    setSelectedId(null)
  }, [])

  const showPreview = Boolean(selectedId) && (isDesktop || mobileOpen)

  return {
    isDesktop,
    selectedId,
    selectRow,
    closePreview,
    showPreview,
  }
}
