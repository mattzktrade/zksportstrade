"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { adminPackagePath } from "@/lib/admin/package-link"
import { PACKAGE_DURATION_OPTIONS, packageDurationLabel } from "@/lib/catalog/package-duration"
import { PackageAdminPanel } from "@/components/admin/package-admin-panel"
import { formatMoneyCompact } from "@/lib/format/money"

function sellableFromInventory(inv: { qty_available: number; qty_held: number } | null): number | null {
  if (!inv) return null
  return Math.max(0, inv.qty_available - inv.qty_held)
}

function rowMatchesSearch(row: AdminPackageRow, q: string): boolean {
  if (!q) return true
  const hay = [
    row.id,
    row.name,
    row.circuit,
    row.location,
    row.country,
    row.race_name,
    row.date_range,
    row.duration ?? "",
    packageDurationLabel(row.duration) ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return hay.includes(q)
}

type StockFilter = "all" | "in_stock" | "out" | "no_inventory"

function rowMatchesStockFilter(row: AdminPackageRow, f: StockFilter): boolean {
  if (f === "all") return true
  const sellable = sellableFromInventory(row.inventory)
  if (f === "no_inventory") return row.inventory == null
  if (row.inventory == null) return false
  if (f === "in_stock") return (sellable ?? 0) > 0
  return (sellable ?? 0) === 0
}

function formatTradeSummary(currency: string, tradePrice: number | null, isEnquiry: boolean): string {
  if (isEnquiry) return "Enquiry"
  if (tradePrice == null) return "—"
  return formatMoneyCompact(currency, tradePrice, 0)
}

export function CatalogAdminTable({ rows, races }: { rows: AdminPackageRow[]; races: AdminRaceOption[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [rows],
  )

  const [search, setSearch] = useState("")
  const [raceFilter, setRaceFilter] = useState("")
  const [stockFilter, setStockFilter] = useState<StockFilter>("all")
  const [durationFilter, setDurationFilter] = useState<string>("")

  const searchNorm = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    return sorted.filter((row) => {
      if (searchNorm && !rowMatchesSearch(row, searchNorm)) return false
      if (raceFilter && row.race_id !== raceFilter) return false
      if (!rowMatchesStockFilter(row, stockFilter)) return false
      if (durationFilter && (row.duration ?? "") !== durationFilter) return false
      return true
    })
  }, [sorted, searchNorm, raceFilter, stockFilter, durationFilter])

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
            src="/images/zk%20small%20image.jpg"
            alt=""
            width={18}
            height={18}
            className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded object-cover pointer-events-none opacity-90"
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
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[160px] flex-1">
            Race
            <select
              value={raceFilter}
              onChange={(e) => setRaceFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">All races</option>
              {races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
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
              <option value="in_stock">In stock (sellable &gt; 0)</option>
              <option value="out">Out of stock</option>
              <option value="no_inventory">No inventory row</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[180px] flex-1">
            Duration
            <select
              value={durationFilter}
              onChange={(e) => setDurationFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">All durations</option>
              {PACKAGE_DURATION_OPTIONS.filter((o) => o.value).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {sorted.length} packages
          {filtered.length === 0 && searchNorm ? " — try clearing search or filters." : ""}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
          No packages match your filters.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <CatalogRow key={row.id} initial={row} races={races} />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogRow({ initial, races }: { initial: AdminPackageRow; races: AdminRaceOption[] }) {
  const [expanded, setExpanded] = useState(false)

  const name = initial.name
  const duration = initial.duration ?? ""
  const currency = initial.currency
  const tradePrice = initial.trade_price
  const isEnquiry = initial.is_enquiry

  const raceLabel = races.find((r) => r.id === initial.race_id)?.name ?? initial.race_name
  const qa = initial.inventory?.qty_available ?? 0
  const qh = initial.inventory?.qty_held ?? 0
  const hasInventoryRow = initial.inventory != null
  const sellableLive = hasInventoryRow ? Math.max(0, qa - qh) : null
  const priceSummary = formatTradeSummary(currency, tradePrice, isEnquiry)

  let stockLabel: string
  let stockClass: string
  if (!hasInventoryRow) {
    stockLabel = "No inventory"
    stockClass = "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30"
  } else if ((sellableLive ?? 0) > 0) {
    stockLabel = `${sellableLive} sellable`
    stockClass = "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30"
  } else {
    stockLabel = "Out of stock"
    stockClass = "bg-muted text-muted-foreground border-border"
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              href={adminPackagePath(initial.id)}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-foreground truncate hover:text-primary hover:underline"
            >
              {name || "Untitled"}
            </Link>
            <span className="text-xs text-muted-foreground font-mono truncate">{initial.id}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {raceLabel}
            {initial.circuit ? ` · ${initial.circuit}` : ""}
            {packageDurationLabel(duration) ? (
              <span className="text-muted-foreground/80"> · {packageDurationLabel(duration)}</span>
            ) : null}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2 py-1 rounded-md border ${stockClass}`}
          title={hasInventoryRow ? `Available ${qa}, held ${qh}` : undefined}
        >
          {stockLabel}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground min-w-[5.5rem] text-right">
          {priceSummary}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 bg-card min-w-0 overflow-hidden">
          <div className="flex justify-end mb-3">
            <Link href={adminPackagePath(initial.id)} className="text-sm text-primary font-medium hover:underline">
              Open full product page →
            </Link>
          </div>
          <PackageAdminPanel initial={initial} races={races} />
        </div>
      )}
    </div>
  )
}