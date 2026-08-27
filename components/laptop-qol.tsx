"use client"

import { useEffect } from "react"
import {
  applyPlatformDataset,
  findBestSearchInput,
  setNativeInputValue,
  shouldIgnoreCommandK,
} from "@/lib/browser/laptop-qol"

/**
 * MacBook / laptop quality-of-life that must not change layout:
 * native overlay scrollbars (via data-platform), ⌘K search, Escape to dismiss,
 * and trackpad-scroll that must not nudge focused number fields.
 */
export function LaptopQol() {
  useEffect(() => {
    applyPlatformDataset()

    function onWheel(event: WheelEvent) {
      const active = document.activeElement
      if (active instanceof HTMLInputElement && (active.type === "number" || active.type === "range")) {
        active.blur()
        return
      }
      if (active instanceof HTMLSelectElement && event.target === active) {
        active.blur()
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === "k") {
        if (shouldIgnoreCommandK(event.target)) return
        const input = findBestSearchInput()
        if (!input) return
        event.preventDefault()
        input.focus()
        input.select()
        return
      }

      if (mod && event.key === "Enter" && event.target instanceof HTMLTextAreaElement) {
        const form = event.target.form
        if (!form) return
        event.preventDefault()
        if (typeof form.requestSubmit === "function") form.requestSubmit()
        else form.submit()
        return
      }

      if (event.key !== "Escape") return
      if (event.target instanceof HTMLSelectElement) return

      const closers = document.querySelectorAll<HTMLElement>("[data-escape-close]")
      if (closers.length > 0) {
        event.preventDefault()
        closers[closers.length - 1].click()
        return
      }

      if (document.querySelector("[role='dialog']")) return

      const active = document.activeElement
      if (active instanceof HTMLInputElement && active.dataset.appSearch) {
        if (active.value) {
          event.preventDefault()
          setNativeInputValue(active, "")
          return
        }
        active.blur()
      }
    }

    window.addEventListener("wheel", onWheel, { passive: true, capture: true })
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true })
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  return null
}
