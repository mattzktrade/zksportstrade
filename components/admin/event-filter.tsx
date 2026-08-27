"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type EventFilterOption = {
  id: string
  label: string
  eventDate?: string | null
}

export function sortEventFilterOptions<T extends EventFilterOption>(options: T[]): T[] {
  return [...options].sort((a, b) => {
    const aDate = a.eventDate ?? ""
    const bDate = b.eventDate ?? ""
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate)
    if (aDate) return -1
    if (bDate) return 1
    return a.label.localeCompare(b.label)
  })
}

export function uniqueEventFilterOptions(
  rows: Array<{ id: string; label: string; eventDate?: string | null }>,
): EventFilterOption[] {
  const byId = new Map<string, EventFilterOption>()
  for (const row of rows) {
    if (!row.id || byId.has(row.id)) continue
    byId.set(row.id, {
      id: row.id,
      label: row.label,
      eventDate: row.eventDate ?? null,
    })
  }
  return sortEventFilterOptions([...byId.values()])
}

export function EventFilter({
  options,
  selectedIds,
  onChange,
  className,
  inputClassName,
}: {
  options: EventFilterOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  className?: string
  inputClassName?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((event) => event.label.toLowerCase().includes(q))
  }, [options, query])
  const summary =
    selectedIds.length === 0
      ? "All events"
      : selectedIds.length === 1
        ? (options.find((event) => event.id === selectedIds[0])?.label ?? "1 event")
        : `${selectedIds.length} events`

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  return (
    <div ref={rootRef} className={cn("relative w-full min-w-0 sm:min-w-[200px] sm:max-w-[280px]", className)}>
      <div className="relative">
        <input
          value={open ? query : summary}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setQuery("")
            setOpen(true)
          }}
          placeholder="Search events…"
          className={cn(
            "h-9 w-full rounded-md border bg-white py-0 pl-3 pr-14 text-[9px] outline-none focus:border-primary/50",
            inputClassName,
          )}
        />
        {selectedIds.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              onChange([])
              setQuery("")
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label="Clear events"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
          aria-label="Toggle events"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open ? (
        <div className="absolute z-40 mt-1 max-h-64 w-[min(360px,70vw)] overflow-y-auto rounded-md border bg-white py-1 shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-[9px] text-slate-400">No matching events.</p>
          ) : (
            matches.map((event) => {
              const checked = selected.has(event.id)
              return (
                <button
                  key={event.id}
                  type="button"
                  onMouseDown={(pointer) => pointer.preventDefault()}
                  onClick={() => {
                    onChange(
                      checked
                        ? selectedIds.filter((id) => id !== event.id)
                        : [...selectedIds, event.id],
                    )
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[9px] hover:bg-slate-50",
                    checked && "bg-red-50 text-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-white" : "border-slate-300 bg-white",
                    )}
                  >
                    {checked ? <Check className="h-2.5 w-2.5" /> : null}
                  </span>
                  {event.label}
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
