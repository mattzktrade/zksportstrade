"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { Search, X } from "lucide-react"
import { listCrmCompanyOptions } from "@/app/(admin)/actions"
import type { CrmCompanyOption } from "@/lib/crm/deals"
import { cn } from "@/lib/utils"

export function CompanySupplierSelect({
  companies,
  value,
  onChange,
  disabled,
  typedName,
  className,
  id,
  excludeIds,
}: {
  companies?: CrmCompanyOption[]
  value: string
  onChange: (accountId: string) => void
  disabled?: boolean
  /** Free-text supplier currently stored on the PO, shown until a company is chosen. */
  typedName?: string | null
  className?: string
  id?: string
  excludeIds?: string[]
}) {
  const [loaded, setLoaded] = useState<CrmCompanyOption[]>(companies ?? [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (companies) {
      setLoaded(companies)
      return
    }
    let cancelled = false
    void listCrmCompanyOptions().then((rows) => {
      if (!cancelled) setLoaded(rows)
    })
    return () => {
      cancelled = true
    }
  }, [companies])

  const available = useMemo(() => {
    if (!excludeIds?.length) return loaded
    const hidden = new Set(excludeIds)
    return loaded.filter((company) => !hidden.has(company.id))
  }, [excludeIds, loaded])

  const selected = useMemo(
    () => available.find((company) => company.id === value) ?? null,
    [available, value],
  )

  useEffect(() => {
    if (open) return
    setQuery(selected?.name ?? "")
  }, [open, selected?.name])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return available
    return available.filter((company) => company.name.toLowerCase().includes(q))
  }, [available, query])

  const activeIndex = results.length === 0 ? 0 : Math.min(highlight, results.length - 1)

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return

    function place() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const maxHeight = 224
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const openUp = spaceBelow < 120 && rect.top > spaceBelow
      setMenuStyle({
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 240),
        zIndex: 80,
        maxHeight,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      })
    }

    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open, query, results.length])

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  function choose(company: CrmCompanyOption) {
    onChange(company.id)
    setQuery(company.name)
    setOpen(false)
    inputRef.current?.blur()
  }

  function clear() {
    onChange("")
    setQuery("")
    setOpen(true)
    inputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      setQuery(selected?.name ?? "")
      inputRef.current?.blur()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setHighlight((current) => Math.min(current + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === "Enter") {
      const match = results[activeIndex]
      if (open && match) {
        event.preventDefault()
        choose(match)
      }
    }
  }

  const hint = typedName?.trim() && !value ? typedName.trim() : null

  return (
    <div ref={rootRef} className="relative space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder="Search companies…"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => {
            const selectedIndex = results.findIndex((company) => company.id === value)
            setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
            setOpen(true)
            inputRef.current?.select()
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-lg border border-border bg-background py-2 text-sm outline-none focus:border-primary/40",
            className,
            "pl-8 pr-8",
          )}
        />
        {query || value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Clear company"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {open && !disabled
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-lg"
            >
              {results.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No matching companies.</p>
              ) : (
                results.map((company, index) => (
                  <button
                    key={company.id}
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(company)}
                    className={cn(
                      "block w-full rounded-md px-2 py-1.5 text-left text-sm",
                      index === activeIndex || company.id === value
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {company.name}
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
      {hint ? (
        <p className="text-[10px] leading-snug text-amber-800 dark:text-amber-200">
          Currently typed as “{hint}”. Pick the matching company to save.
        </p>
      ) : null}
    </div>
  )
}
