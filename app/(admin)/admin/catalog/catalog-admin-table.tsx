"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { LOGO_ICON } from "@/lib/branding"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { linkedPackagesFromAdminRows, type LinkedInventoryPackage } from "@/lib/admin/linked-inventory"
import { adminCatalogProductTitleFromPackage } from "@/lib/admin/catalog-product-title"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { adminPackagePath } from "@/lib/admin/package-link"
import { isBookableEventDate } from "@/lib/catalog/bookable-events"
import { PackageAdminPanel } from "@/components/admin/package-admin-panel"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"

const CATALOG_FILTER_STORAGE_KEY = "zk-admin-catalog-filters-v1"

function sellableFromInventory(inv: { qty_available: number; qty_held: number } | null): number | null {
  if (!inv) return null
  return Math.max(0, inv.qty_available - inv.qty_held)
}

function rowMatchesSearch(row: AdminPackageRow, q: string): boolean {
  if (!q) return true
  const hay = [row.id, row.name, row.circuit, row.location, row.country, row.race_name, row.date_range, row.product_code]
    .join(" ")
    .toLowerCase()
  return hay.includes(q)
}

type StockFilter = "all" | "in_stock" | "out_of_stock"
type ScheduleFilter = "upcoming" | "all"
type VisibilityFilter = "all" | "visible" | "hidden"

type SavedCatalogFilters = {
  search?: string
  raceFilter?: string
  scheduleFilter?: ScheduleFilter
  visibilityFilter?: VisibilityFilter
  stockFilter?: StockFilter
}

function rowMatchesVisibility(row: AdminPackageRow, f: VisibilityFilter): boolean {
  if (f === "all") return true
  if (f === "hidden") return row.is_hidden
  return !row.is_hidden
}

function rowMatchesScheduleFilter(row: AdminPackageRow, f: ScheduleFilter): boolean {
  if (f === "all") return true
  return isBookableEventDate(row.event_date)
}

function rowMatchesStockFilter(row: AdminPackageRow, f: StockFilter): boolean {
  if (f === "all") return true
  const sellable = sellableFromInventory(row.inventory)
  if (f === "in_stock") return (sellable ?? 0) > 0
  return row.inventory == null || (sellable ?? 0) === 0
}

function formatTradeSummary(currency: string, tradePrice: number | null, isEnquiry: boolean): string {
  if (isEnquiry) return "Enquiry"
  if (tradePrice == null) return "—"
  return formatMoneyCompact(currency, tradePrice, 0)
}

export function CatalogAdminTable({
  rows,
  races,
  wixListingsByPackage = {},
}: {
  rows: AdminPackageRow[]
  races: AdminRaceOption[]
  wixListingsByPackage?: Record<string, WixChannelListingRow[]>
}) {
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const dateA = (a.event_date ?? "").slice(0, 10)
        const dateB = (b.event_date ?? "").slice(0, 10)
        if (dateA !== dateB) return dateA.localeCompare(dateB)
        const raceA = a.race_name ?? a.race_id ?? ""
        const raceB = b.race_name ?? b.race_id ?? ""
        if (raceA !== raceB) return raceA.localeCompare(raceB)
        return a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      }),
    [rows],
  )

  const [search, setSearch] = useState("")
  const [raceFilter, setRaceFilter] = useState("")
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("upcoming")
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all")
  const [stockFilter, setStockFilter] = useState<StockFilter>("all")
  const [filtersReady, setFiltersReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATALOG_FILTER_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as SavedCatalogFilters
      if (typeof saved.search === "string") setSearch(saved.search)
      if (typeof saved.raceFilter === "string") setRaceFilter(saved.raceFilter)
      if (saved.scheduleFilter === "upcoming" || saved.scheduleFilter === "all") {
        setScheduleFilter(saved.scheduleFilter)
      }
      if (saved.visibilityFilter === "all" || saved.visibilityFilter === "visible" || saved.visibilityFilter === "hidden") {
        setVisibilityFilter(saved.visibilityFilter)
      }
      if (saved.stockFilter === "all" || saved.stockFilter === "in_stock" || saved.stockFilter === "out_of_stock") {
        setStockFilter(saved.stockFilter)
      }
    } catch {
      /* ignore */
    } finally {
      setFiltersReady(true)
    }
  }, [])

  useEffect(() => {
    if (!filtersReady) return
    const payload: SavedCatalogFilters = {
      search,
      raceFilter,
      scheduleFilter,
      visibilityFilter,
      stockFilter,
    }
    localStorage.setItem(CATALOG_FILTER_STORAGE_KEY, JSON.stringify(payload))
  }, [search, raceFilter, scheduleFilter, visibilityFilter, stockFilter, filtersReady])

  const searchNorm = search.trim().toLowerCase()

  const racesForDropdown = useMemo(() => {
    if (scheduleFilter === "all") return races
    return races.filter((r) => isBookableEventDate(r.event_date))
  }, [races, scheduleFilter])

  const filtered = useMemo(() => {
    return sorted.filter((row) => {
      if (!rowMatchesScheduleFilter(row, scheduleFilter)) return false
      if (!rowMatchesVisibility(row, visibilityFilter)) return false
      if (searchNorm && !rowMatchesSearch(row, searchNorm)) return false
      if (raceFilter && row.race_id !== raceFilter) return false
      if (!rowMatchesStockFilter(row, stockFilter)) return false
      return true
    })
  }, [sorted, searchNorm, raceFilter, scheduleFilter, visibilityFilter, stockFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: AdminPackageRow[] }>()
    for (const row of filtered) {
      const key = row.race_id || row.race_name || "other"
      if (!map.has(key)) {
        const race = races.find((r) => r.id === row.race_id)
        map.set(key, { label: race ? adminRaceLabel(race) : row.race_name || "Other", rows: [] })
      }
      map.get(key)!.rows.push(row)
    }
    return [...map.values()]
  }, [filtered, races])

  const upcomingCount = useMemo(
    () => sorted.filter((row) => rowMatchesScheduleFilter(row, "upcoming")).length,
    [sorted],
  )

  function resetFilters() {
    setSearch("")
    setRaceFilter("")
    setScheduleFilter("upcoming")
    setVisibilityFilter("all")
    setStockFilter("all")
  }

  const hasActiveFilters =
    search.trim() !== "" ||
    raceFilter !== "" ||
    scheduleFilter !== "upcoming" ||
    visibilityFilter !== "all" ||
    stockFilter !== "all"

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No packages in the database yet. Create one above, or run your catalog seed.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="relative">
          <Image
            src={LOGO_ICON.src}
            alt=""
            width={LOGO_ICON.width}
            height={LOGO_ICON.height}
            className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 object-contain pointer-events-none opacity-90"
            sizes="18px"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, circuit, race, id…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm"
            aria-label="Search packages"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[180px] flex-1">
            Schedule
            <select
              value={scheduleFilter}
              onChange={(e) => {
                const next = e.target.value as ScheduleFilter
                setScheduleFilter(next)
                if (next === "upcoming" && raceFilter) {
                  const race = races.find((r) => r.id === raceFilter)
                  if (race && !isBookableEventDate(race.event_date)) setRaceFilter("")
                }
              }}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="upcoming">Upcoming events only</option>
              <option value="all">All events (incl. past)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[160px] flex-1">
            Race
            <select
              value={raceFilter}
              onChange={(e) => setRaceFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">All races</option>
              {racesForDropdown.map((r) => (
                <option key={r.id} value={r.id}>
                  {adminRaceLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[150px] flex-1">
            Portal visibility
            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value as VisibilityFilter)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="all">All</option>
              <option value="visible">Visible on portal</option>
              <option value="hidden">Hidden on portal</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[160px] flex-1">
            Stock
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as StockFilter)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="all">All</option>
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock / no inventory</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {scheduleFilter === "upcoming" ? upcomingCount : sorted.length} packages
            {scheduleFilter === "upcoming" && upcomingCount < sorted.length
              ? ` (${sorted.length - upcomingCount} past hidden — switch schedule to view)`
              : ""}
            {filtered.length === 0 ? " — try clearing search or filters." : ""}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-primary hover:underline"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
          No packages match your filters.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.label} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
                {group.label}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
                  {" "}
                  · {group.rows.length} package{group.rows.length === 1 ? "" : "s"}
                </span>
              </h3>
              <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                {group.rows.map((row) => (
                  <CatalogRow
                    key={row.id}
                    initial={row}
                    races={races}
                    wixListings={wixListingsByPackage[row.id] ?? []}
                    linkedPackages={linkedPackagesFromAdminRows(row, sorted)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogRow({
  initial,
  races,
  wixListings = [],
  linkedPackages = [],
}: {
  initial: AdminPackageRow
  races: AdminRaceOption[]
  wixListings?: WixChannelListingRow[]
  linkedPackages?: LinkedInventoryPackage[]
}) {
  const [expanded, setExpanded] = useState(false)

  const currency = initial.currency
  const tradePrice = initial.trade_price
  const isEnquiry = initial.is_enquiry

  const raceMatch = races.find((r) => r.id === initial.race_id)
  const displayTitle = adminCatalogProductTitleFromPackage(initial, raceMatch)
  const qa = initial.inventory?.qty_available ?? 0
  const qh = initial.inventory?.qty_held ?? 0
  const hasInventoryRow = initial.inventory != null
  const sellableLive = hasInventoryRow ? Math.max(0, qa - qh) : null
  const priceSummary = formatTradeSummary(currency, tradePrice, isEnquiry)
  const sfCode = initial.product_code?.trim()

  let stockLabel: string
  let stockClass: string
  if (!hasInventoryRow) {
    stockLabel = "No stock"
    stockClass = "text-amber-800 dark:text-amber-200"
  } else if ((sellableLive ?? 0) > 0) {
    stockLabel = `${sellableLive} avail.`
    stockClass = "text-emerald-700 dark:text-emerald-300"
  } else {
    stockLabel = "Out of stock"
    stockClass = "text-muted-foreground"
  }

  const isHidden = initial.is_hidden

  return (
    <div className={cn("min-w-0", isHidden && "opacity-80")}>
      <div className="flex items-stretch gap-0">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 px-3 py-3.5 text-muted-foreground hover:bg-muted/40 transition-colors"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex flex-1 min-w-0 items-center gap-4 py-3 pr-4">
          <div className="min-w-0 flex-1">
            <Link
              href={adminPackagePath(initial.id)}
              className="font-medium text-foreground hover:text-primary hover:underline truncate block"
            >
              {initial.name || displayTitle || "Untitled"}
            </Link>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {[initial.date_range, initial.circuit || initial.location].filter(Boolean).join(" · ")}
              {sfCode ? (
                <>
                  {" "}
                  · <span className="font-mono text-foreground/80">SF {sfCode}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="hidden sm:flex shrink-0 items-center gap-3 text-sm">
            {isHidden ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hidden</span>
            ) : null}
            <span className={cn("text-xs font-medium tabular-nums", stockClass)} title={hasInventoryRow ? `Available ${qa}, held ${qh}` : undefined}>
              {stockLabel}
            </span>
            <span className="font-semibold tabular-nums text-foreground min-w-[4.5rem] text-right">
              {priceSummary}
            </span>
          </div>
        </div>
      </div>

      <div className="sm:hidden flex items-center justify-between gap-3 px-4 pb-3 -mt-1 text-sm">
        <span className={cn("text-xs font-medium tabular-nums", stockClass)}>{stockLabel}</span>
        <span className="font-semibold tabular-nums">{priceSummary}</span>
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 min-w-0 overflow-hidden">
          <div className="flex justify-end mb-3">
            <Link href={adminPackagePath(initial.id)} className="text-sm text-primary font-medium hover:underline">
              Open full product page →
            </Link>
          </div>
          <PackageAdminPanel
            initial={initial}
            races={races}
            wixListings={wixListings}
            linkedPackages={linkedPackages}
          />
        </div>
      )}
    </div>
  )
}
