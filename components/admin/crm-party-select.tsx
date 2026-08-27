"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronsUpDown } from "lucide-react"
import { searchCrmParties } from "@/app/(admin)/admin/search-actions"
import { ADMIN_SEARCH_MIN_QUERY } from "@/lib/admin/ranked-search"
import type { CrmAccountOption } from "@/lib/crm/deal-types"
import {
  mergeCrmAccountOptions,
  mergeCrmPartyHits,
  searchCrmPartiesLocal,
  type CrmPartySearchHit,
} from "@/lib/crm/party-search"
import { cn } from "@/lib/utils"

const MENU_GAP = 4
const VIEWPORT_MARGIN = 12
const MENU_MAX_HEIGHT = 320

type MenuBox = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight
}

export function CrmPartySelect({
  accountId,
  localAccounts,
  onSelect,
  placeholder = "Search accounts and contacts…",
  emptyLabel = "No accounts or contacts match",
  className,
  createLabel,
  onCreate,
}: {
  accountId: string
  localAccounts: CrmAccountOption[]
  onSelect: (account: CrmAccountOption, contactId?: string) => void
  placeholder?: string
  emptyLabel?: string
  className?: string
  createLabel?: (query: string) => string
  onCreate?: (query: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [knownAccounts, setKnownAccounts] = useState<CrmAccountOption[]>([])
  const accounts = useMemo(
    () => mergeCrmAccountOptions([...localAccounts, ...knownAccounts]),
    [knownAccounts, localAccounts],
  )
  const selected = accounts.find((account) => account.id === accountId) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(selected?.name ?? "")
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [remoteHits, setRemoteHits] = useState<CrmPartySearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) setQuery(selected?.name ?? "")
  }, [open, selected?.name])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }
    function updatePosition(event?: Event) {
      if (
        event &&
        menuRef.current &&
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      ) {
        return
      }
      const el = inputRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const spaceBelow = viewportHeight() - rect.bottom - MENU_GAP - VIEWPORT_MARGIN
      const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN
      const openAbove = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow
      const available = Math.max(0, openAbove ? spaceAbove : spaceBelow)
      const maxHeight = Math.min(MENU_MAX_HEIGHT, available)
      const next: MenuBox = {
        ...(openAbove
          ? { bottom: viewportHeight() - rect.top + MENU_GAP }
          : { top: rect.bottom + MENU_GAP }),
        left: rect.left,
        width: rect.width,
        maxHeight,
      }
      setMenuBox((current) =>
        current &&
        current.top === next.top &&
        current.bottom === next.bottom &&
        current.left === next.left &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      )
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.visualViewport?.addEventListener("resize", updatePosition)
    window.visualViewport?.addEventListener("scroll", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.visualViewport?.removeEventListener("resize", updatePosition)
      window.visualViewport?.removeEventListener("scroll", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open])

  const localHits = useMemo(() => {
    const q = query.trim()
    if (!q || q.length < ADMIN_SEARCH_MIN_QUERY || query === selected?.name) return []
    return searchCrmPartiesLocal(accounts, q)
  }, [accounts, query, selected?.name])

  const matches = useMemo(() => {
    const q = query.trim()
    if (!q || q.length < ADMIN_SEARCH_MIN_QUERY || query === selected?.name) return []
    return mergeCrmPartyHits(localHits, remoteHits, q)
  }, [localHits, query, remoteHits, selected?.name])

  useEffect(() => {
    const q = query.trim()
    if (!open || !q || q.length < ADMIN_SEARCH_MIN_QUERY || query === selected?.name) {
      setRemoteHits([])
      setLoading(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      void searchCrmParties(q).then((hits) => {
        if (cancelled) return
        setRemoteHits(hits)
        setKnownAccounts((current) => mergeCrmAccountOptions([...current, ...hits.map((hit) => hit.account)]))
        setLoading(false)
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, selected?.name])

  const activeIndex = matches.length === 0 ? 0 : Math.min(highlight, matches.length - 1)

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const node = menuRef.current?.querySelector("[data-active='true']")
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" })
  }, [activeIndex, open])

  function choose(hit: CrmPartySearchHit) {
    setKnownAccounts((current) => mergeCrmAccountOptions([...current, hit.account]))
    onSelect(hit.account, hit.contactId)
    setQuery(hit.account.name)
    setOpen(false)
  }

  const createQuery = query.trim()
  const showCreate = Boolean(onCreate && createQuery && createQuery !== selected?.name)
  const waitingForLetters = open && query.trim().length > 0 && query.trim().length < ADMIN_SEARCH_MIN_QUERY

  const menu =
    open && menuBox ? (
      <div
        ref={menuRef}
        style={{
          top: menuBox.top,
          bottom: menuBox.bottom,
          left: menuBox.left,
          width: menuBox.width,
          maxHeight: menuBox.maxHeight,
        }}
        className="fixed z-[120] overflow-y-auto overscroll-contain rounded-md border bg-white py-1 shadow-lg"
      >
        {waitingForLetters ? (
          <p className="px-3 py-2 text-[10px] text-slate-400">Type at least two letters.</p>
        ) : matches.length === 0 ? (
          <p className="px-3 py-2 text-[10px] text-slate-400">
            {loading ? "Searching…" : query.trim() && query !== selected?.name ? emptyLabel : "Type to search accounts and contacts."}
          </p>
        ) : (
          matches.map((hit, index) => (
            <button
              key={hit.key}
              type="button"
              data-active={index === activeIndex ? "true" : undefined}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(hit)}
              className={cn(
                "block w-full px-3 py-1.5 text-left hover:bg-slate-50",
                index === activeIndex && "bg-red-50 text-primary",
              )}
            >
              <span className="block text-[10px] font-medium">{hit.label}</span>
              <span className="block text-[9px] text-slate-400">{hit.hint}</span>
            </button>
          ))
        )}
        {loading && matches.length > 0 ? (
          <p className="px-3 py-1 text-[9px] text-slate-400">Updating results…</p>
        ) : null}
        {showCreate ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onCreate?.(createQuery)
              setOpen(false)
            }}
            className="block w-full border-t px-3 py-1.5 text-left text-[10px] font-medium text-primary hover:bg-red-50"
          >
            {createLabel?.(createQuery) ?? `Create “${createQuery}” as a new account`}
          </button>
        ) : null}
      </div>
    ) : null

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (!event.target.value.trim()) onSelect({ id: "", name: "", contacts: [] })
          }}
          onFocus={(event) => {
            setOpen(true)
            event.target.select()
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false)
              setQuery(selected?.name ?? "")
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
              if (open && match) {
                event.preventDefault()
                choose(match)
              }
            }
          }}
          placeholder={placeholder}
          className={cn("pr-8", className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (open) {
              setOpen(false)
              inputRef.current?.blur()
              return
            }
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
