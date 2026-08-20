"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

export type SearchableSelectOption = {
  value: string
  label: string
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  emptyLabel = "No matches",
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  emptyLabel?: string
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(selected?.label ?? "")
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "")
  }, [open, selected?.label])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  useEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }
    function updatePosition() {
      const el = inputRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setMenuBox({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || query === selected?.label) return options
    return options.filter((option) => option.label.toLowerCase().includes(q))
  }, [options, query, selected?.label])

  const menu =
    open && menuBox ? (
      <div
        ref={menuRef}
        style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
        className="fixed z-[120] max-h-56 overflow-y-auto rounded-md border bg-white py-1 shadow-lg"
      >
        {matches.length === 0 ? (
          <p className="px-3 py-2 text-[10px] text-slate-400">{emptyLabel}</p>
        ) : (
          matches.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setQuery(option.label)
                setOpen(false)
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-[10px] hover:bg-slate-50",
                option.value === value && "bg-red-50 text-primary",
              )}
            >
              {option.label}
            </button>
          ))
        )}
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
            if (!event.target.value.trim()) onChange("")
          }}
          onFocus={(event) => {
            setOpen(true)
            event.target.select()
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false)
              setQuery(selected?.label ?? "")
              event.currentTarget.blur()
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
