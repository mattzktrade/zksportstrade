"use client"

import { cn } from "@/lib/utils"
import type { PortalCatalogSeasonYear } from "@/lib/catalog/portal-catalog"

export function CatalogSeasonTabs({
  seasons,
  activeYear,
  onChange,
  className,
}: {
  seasons: { year: PortalCatalogSeasonYear; label: string; raceCount: number }[]
  activeYear: PortalCatalogSeasonYear
  onChange: (year: PortalCatalogSeasonYear) => void
  className?: string
}) {
  if (seasons.length <= 1) return null

  return (
    <div
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5", className)}
      role="tablist"
      aria-label="Catalog season"
    >
      {seasons.map((s) => {
        const active = s.year === activeYear
        return (
          <button
            key={s.year}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s.year)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{s.year}</span>
            <span
              className={cn(
                "min-w-[1.25rem] text-center text-[11px] font-medium tabular-nums leading-none rounded-md px-1.5 py-0.5",
                active ? "bg-foreground/8 text-foreground" : "bg-transparent text-muted-foreground/80",
              )}
            >
              {s.raceCount}
            </span>
          </button>
        )
      })}
    </div>
  )
}
