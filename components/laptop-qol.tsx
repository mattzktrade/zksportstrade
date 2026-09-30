"use client"

import { useEffect } from "react"
import { flushSync } from "react-dom"
import { correctCompletedWord, correctProse, proseBoundary } from "@/lib/browser/british-autocorrect"
import {
  applyPlatformDataset,
  findBestSearchInput,
  setNativeInputValue,
  setNativeTextAreaValue,
  shouldIgnoreCommandK,
} from "@/lib/browser/laptop-qol"

function adminCrmOpen() {
  return document.querySelector(".admin-shell") != null
}

function canAutocorrect(el: HTMLTextAreaElement) {
  if (!adminCrmOpen()) return false
  if (el.dataset.autocorrect === "off") return false
  if (el.getAttribute("spellcheck") === "false") return false
  if (el.readOnly || el.disabled) return false
  return true
}

function placeCaret(el: HTMLTextAreaElement, caret: number, expected: string) {
  if (document.activeElement !== el || el.value !== expected) return
  el.setSelectionRange(caret, caret)
}

function writeProse(el: HTMLTextAreaElement, value: string, caret: number | null) {
  setNativeTextAreaValue(el, value)
  if (caret == null) return
  const place = () => placeCaret(el, caret, value)
  place()
  queueMicrotask(place)
  requestAnimationFrame(place)
}

function commitProse(el: HTMLTextAreaElement) {
  if (!canAutocorrect(el)) return
  const next = correctProse(el.value)
  if (next === el.value) return
  flushSync(() => {
    setNativeTextAreaValue(el, next)
  })
}

/**
 * MacBook / laptop quality-of-life that must not change layout:
 * native overlay scrollbars (via data-platform), ⌘K search, Escape to dismiss,
 * trackpad-scroll that must not nudge focused number fields,
 * and British English autocorrect on CRM note fields.
 */
export function LaptopQol() {
  useEffect(() => {
    applyPlatformDataset()

    function onFocusIn(event: FocusEvent) {
      const el = event.target
      if (!(el instanceof HTMLTextAreaElement) || !canAutocorrect(el)) return
      el.lang = "en-GB"
      el.setAttribute("spellcheck", "true")
      el.setAttribute("autocapitalize", "sentences")
      el.setAttribute("autocorrect", "on")
    }

    function onPointerDown(event: PointerEvent) {
      const active = document.activeElement
      if (!(active instanceof HTMLTextAreaElement)) return
      if (event.target instanceof Node && active.contains(event.target)) return
      commitProse(active)
    }

    function onFocusOut(event: FocusEvent) {
      const el = event.target
      if (!(el instanceof HTMLTextAreaElement)) return
      commitProse(el)
    }

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
      if (
        event.target instanceof HTMLTextAreaElement &&
        canAutocorrect(event.target) &&
        !event.isComposing &&
        !event.altKey
      ) {
        const el = event.target
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? 0
        if (start === end && !event.metaKey && !event.ctrlKey) {
          if (event.key === "Tab") {
            const corrected = correctCompletedWord(el.value, start)
            if (corrected) writeProse(el, corrected.value, corrected.caret)
          } else {
            const boundary = proseBoundary(event.key)
            if (boundary) {
              const corrected = correctCompletedWord(el.value, start)
              if (corrected) {
                event.preventDefault()
                const value =
                  corrected.value.slice(0, corrected.caret) + boundary + corrected.value.slice(corrected.caret)
                writeProse(el, value, corrected.caret + boundary.length)
                return
              }
            }
          }
        }
      }

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
        commitProse(event.target)
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

    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("wheel", onWheel, { passive: true, capture: true })
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("wheel", onWheel, { capture: true })
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  return null
}
