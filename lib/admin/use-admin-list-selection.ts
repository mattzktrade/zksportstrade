"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"

export const ADMIN_DESKTOP_SPLIT_MQ = "(min-width: 1280px)"

/**
 * Desktop split views keep the first row selected. On smaller screens the
 * preview overlay stays closed until the user taps a row (unless a deep link
 * supplied `initialId`).
 */
export function useAdminListSelection(options: {
  initialId?: string | null
  firstId: string | null
}) {
  const initialId = options.initialId ?? null
  const firstId = options.firstId
  const [isDesktop, setIsDesktop] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialId)
  const [mobileOpen, setMobileOpen] = useState(Boolean(initialId))
  const skipDesktopAutoSelect = useRef(false)

  useLayoutEffect(() => {
    const mq = window.matchMedia(ADMIN_DESKTOP_SPLIT_MQ)
    function sync() {
      const desktop = mq.matches
      setIsDesktop(desktop)
      if (desktop && !skipDesktopAutoSelect.current) {
        setSelectedId((current) => current ?? firstId)
      }
    }
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [firstId])

  useLayoutEffect(() => {
    if (!initialId) return
    skipDesktopAutoSelect.current = false
    setSelectedId(initialId)
    setMobileOpen(true)
  }, [initialId])

  const selectRow = useCallback((id: string) => {
    skipDesktopAutoSelect.current = false
    setSelectedId(id)
    setMobileOpen(true)
  }, [])

  const closePreview = useCallback(() => {
    skipDesktopAutoSelect.current = true
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
