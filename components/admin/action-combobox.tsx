"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function ActionCombobox({
  value,
  onChange,
  options,
  placeholder = "Select or type an action…",
  inputClassName,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly string[]
  placeholder?: string
  inputClassName?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    const filtered = q
      ? options.filter((option) => option.toLowerCase().includes(q))
      : [...options]
    if (q && !options.some((option) => option.toLowerCase() === q)) {
      return filtered
    }
    return filtered
  }, [options, value])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [])

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={cn("pr-8", inputClassName)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && matches.length > 0 ? (
        <div className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white py-1 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {matches.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-[9px] hover:bg-slate-50",
                option === value && "bg-red-50 text-primary",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
