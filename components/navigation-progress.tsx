"use client"

import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

const STUCK_MS = 12_000

export function signalNavigation(href: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("zk-navigate", { detail: href }))
}

function sameDocument(href: string): boolean {
  try {
    const url = new URL(href, window.location.href)
    return (
      url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    )
  } catch {
    return true
  }
}

/**
 * Paints a bar the moment an in-app navigation starts. If the App Router
 * never commits (the "click, wait, then refresh" stall), offer a full load
 * of that same URL instead of leaving the click looking dead.
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    setPendingHref(null)
    setStuck(false)
  }, [pathname])

  useEffect(() => {
    function begin(href: string) {
      if (!href.startsWith("/") || sameDocument(href)) return
      setStuck(false)
      setPendingHref(href)
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a")
      if (!anchor) return
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return
      begin(href)
    }

    function onSignal(event: Event) {
      const href = (event as CustomEvent<string>).detail
      if (typeof href === "string") begin(href)
    }

    document.addEventListener("click", onClick, true)
    window.addEventListener("zk-navigate", onSignal)
    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("zk-navigate", onSignal)
    }
  }, [])

  useEffect(() => {
    if (!pendingHref) return
    const timer = window.setTimeout(() => setStuck(true), STUCK_MS)
    return () => window.clearTimeout(timer)
  }, [pendingHref])

  if (!pendingHref) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80]">
      <div
        className="h-1 bg-[#F90202] animate-pulse"
        role="progressbar"
        aria-label="Loading page"
      />
      {stuck ? (
        <div className="pointer-events-auto flex justify-center px-3 pt-2">
          <button
            type="button"
            className="rounded-full bg-[#070707] px-3 py-1.5 text-xs font-medium text-white shadow-lg"
            onClick={() => {
              window.location.assign(pendingHref)
            }}
          >
            Still loading — open this page
          </button>
        </div>
      ) : null}
    </div>
  )
}
