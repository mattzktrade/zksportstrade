"use client"

import { useEffect } from "react"

/** Close a dialog/sheet that has no backdrop click handler. */
export function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (event.target instanceof HTMLSelectElement) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, onClose])
}
