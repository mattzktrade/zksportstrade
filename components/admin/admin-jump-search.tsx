"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { searchAdminRecords } from "@/app/(admin)/admin/search-actions"
import {
  mergeAdminJumpResults,
  type AdminJumpPage,
  type AdminRecordHit,
} from "@/lib/admin/admin-record-search"
import { ADMIN_SEARCH_MIN_QUERY } from "@/lib/admin/ranked-search"
import { headerSearchProps } from "@/lib/browser/laptop-qol"
import { cn } from "@/lib/utils"

export type AdminJumpItem = AdminJumpPage

export function AdminJumpSearch({ destinations }: { destinations: AdminJumpItem[] }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [records, setRecords] = useState<AdminRecordHit[]>([])
  const [loading, setLoading] = useState(false)
  const matches = useMemo(
    () => mergeAdminJumpResults(destinations, records, query),
    [destinations, query, records],
  )
  const activeIndex = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1)

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < ADMIN_SEARCH_MIN_QUERY) {
      setRecords([])
      setLoading(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      void searchAdminRecords(q).then((hits) => {
        if (cancelled) return
        setRecords(hits)
        setLoading(false)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  function go(href: string) {
    setOpen(false)
    setQuery("")
    setRecords([])
    inputRef.current?.blur()
    router.push(href)
  }

  return (
    <div ref={rootRef} className="relative ml-auto hidden w-full max-w-[420px] md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        {...headerSearchProps}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false)
            setQuery("")
            setRecords([])
            event.currentTarget.blur()
            return
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setOpen(true)
            setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)))
            return
          }
          if (event.key === "ArrowUp") {
            event.preventDefault()
            setHighlight((current) => Math.max(current - 1, 0))
            return
          }
          if (event.key === "Enter") {
            const match = matches[activeIndex]
            if (match) {
              event.preventDefault()
              go(match.href)
            }
          }
        }}
        placeholder="Search orders, leads, clients, events..."
        className="h-9 w-full rounded-md border border-[#e3e5e9] bg-white pl-9 pr-14 text-[11px] text-slate-700 outline-none focus:border-primary/40"
        aria-label="Search admin records"
        aria-expanded={open}
        aria-controls="admin-jump-results"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">
        <span className="shortcut-meta">⌘K</span>
        <span className="shortcut-ctrl">Ctrl K</span>
      </span>
      {open ? (
        <div
          id="admin-jump-results"
          role="listbox"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto overscroll-contain rounded-md border border-[#e3e5e9] bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-slate-400">
              {loading
                ? "Searching…"
                : query.trim().length > 0 && query.trim().length < ADMIN_SEARCH_MIN_QUERY
                  ? "Type at least two letters."
                  : query.trim()
                    ? "No matching records."
                    : "Type to search orders, clients, contacts, deals, and events."}
            </p>
          ) : (
            matches.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(item.href)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-1.5 text-left",
                  index === activeIndex ? "bg-red-50 text-primary" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span className="mt-0.5 w-14 shrink-0 text-[8px] font-semibold uppercase tracking-wide text-slate-400">
                  {item.kindLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px]">{item.label}</span>
                  {item.hint ? <span className="block text-[9px] text-slate-400">{item.hint}</span> : null}
                </span>
              </button>
            ))
          )}
          {loading && matches.length > 0 ? (
            <p className="px-3 py-1 text-[9px] text-slate-400">Updating results…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
