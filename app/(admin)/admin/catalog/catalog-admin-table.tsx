"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { insertPackageInventory, updateInventoryRow, updatePackageFields } from "@/app/(admin)/actions"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

function galleryToText(g: unknown): string {
  if (!Array.isArray(g)) return ""
  return g
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim())
    .join("\n")
}

function includesToText(inc: unknown): string {
  if (!Array.isArray(inc)) return ""
  return inc.filter((x): x is string => typeof x === "string").join("\n")
}

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
  const cur = (currency || "USD").trim() || "USD"
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur.length === 3 ? cur : "USD",
      maximumFractionDigits: 0,
    }).format(tradePrice)
  } catch {
    return `${cur} ${tradePrice}`
  }
}

const TIERS = ["paddock", "champions", "legend", "hero"] as const

export function CatalogAdminTable({ rows, races }: { rows: AdminPackageRow[]; races: AdminRaceOption[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [rows],
  )

  const [search, setSearch] = useState("")
  const [raceFilter, setRaceFilter] = useState("")
  const [stockFilter, setStockFilter] = useState<StockFilter>("all")
  const [tierFilter, setTierFilter] = useState<string>("")

  const searchNorm = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    return sorted.filter((row) => {
      if (searchNorm && !rowMatchesSearch(row, searchNorm)) return false
      if (raceFilter && row.race_id !== raceFilter) return false
      if (!rowMatchesStockFilter(row, stockFilter)) return false
      if (tierFilter && row.tier !== tierFilter) return false
      return true
    })
  }, [sorted, searchNorm, raceFilter, stockFilter, tierFilter])

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
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:min-w-[140px] flex-1">
            Tier
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">All tiers</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
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
  const router = useRouter()
  const [pending, start] = useTransition()
  const [expanded, setExpanded] = useState(false)

  const [raceId, setRaceId] = useState(initial.race_id)
  const [name, setName] = useState(initial.name)
  const [circuit, setCircuit] = useState(initial.circuit)
  const [location, setLocation] = useState(initial.location)
  const [country, setCountry] = useState(initial.country)
  const [countryCode, setCountryCode] = useState(initial.country_code)
  const [eventDate, setEventDate] = useState(String(initial.event_date).slice(0, 10))
  const [dateRange, setDateRange] = useState(initial.date_range)
  const [description, setDescription] = useState(typeof initial.description === "string" ? initial.description : "")
  const [image, setImage] = useState(initial.image ?? "")
  const [galleryText, setGalleryText] = useState(galleryToText(initial.gallery_images))
  const [currency, setCurrency] = useState(initial.currency)
  const [totalCapacity, setTotalCapacity] = useState(String(initial.total_capacity))
  const [tier, setTier] = useState(initial.tier)
  const [includesText, setIncludesText] = useState(includesToText(initial.includes))
  const [tradePrice, setTradePrice] = useState(
    initial.trade_price != null ? String(initial.trade_price) : "",
  )
  const [isEnquiry, setIsEnquiry] = useState(initial.is_enquiry)
  const [featured, setFeatured] = useState(initial.featured)
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order))
  const [brochureUrl, setBrochureUrl] = useState(
    typeof initial.brochure_url === "string" ? initial.brochure_url : "",
  )
  const [qtyAvailable, setQtyAvailable] = useState(String(initial.inventory?.qty_available ?? 0))
  const [qtyHeld, setQtyHeld] = useState(String(initial.inventory?.qty_held ?? 0))

  useEffect(() => {
    setRaceId(initial.race_id)
    setName(initial.name)
    setCircuit(initial.circuit)
    setLocation(initial.location)
    setCountry(initial.country)
    setCountryCode(initial.country_code)
    setEventDate(String(initial.event_date).slice(0, 10))
    setDateRange(initial.date_range)
    setDescription(typeof initial.description === "string" ? initial.description : "")
    setImage(initial.image ?? "")
    setGalleryText(galleryToText(initial.gallery_images))
    setCurrency(initial.currency)
    setTotalCapacity(String(initial.total_capacity))
    setTier(initial.tier)
    setIncludesText(includesToText(initial.includes))
    setTradePrice(initial.trade_price != null ? String(initial.trade_price) : "")
    setIsEnquiry(initial.is_enquiry)
    setFeatured(initial.featured)
    setSortOrder(String(initial.sort_order))
    setBrochureUrl(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
    setQtyAvailable(String(initial.inventory?.qty_available ?? 0))
    setQtyHeld(String(initial.inventory?.qty_held ?? 0))
  }, [initial])

  function parsePrice(): number | null {
    const t = tradePrice.trim()
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  function savePackage() {
    start(async () => {
      const price = parsePrice()
      if (tradePrice.trim() !== "" && price === null) {
        toast.error("Trade price must be a number or empty for enquiry-style pricing.")
        return
      }
      const so = Math.floor(Number(sortOrder))
      if (!Number.isFinite(so)) {
        toast.error("Sort order must be a number.")
        return
      }
      const cap = Math.floor(Number(totalCapacity))
      if (!Number.isFinite(cap) || cap < 0) {
        toast.error("Total capacity must be a non-negative whole number.")
        return
      }

      const res = await updatePackageFields({
        packageId: initial.id,
        race_id: raceId.trim(),
        name: name.trim(),
        circuit: circuit.trim(),
        location: location.trim(),
        country: country.trim(),
        country_code: countryCode.trim(),
        event_date: eventDate.trim(),
        date_range: dateRange.trim(),
        description: description.trim(),
        image: image.trim() || null,
        gallery_images: linesToList(galleryText),
        currency: currency.trim() || "USD",
        total_capacity: cap,
        tier,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        featured,
        sort_order: so,
        brochure_url: brochureUrl.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Package updated.")
      router.refresh()
    })
  }

  function saveInventory() {
    start(async () => {
      const qa = Math.floor(Number(qtyAvailable))
      const qh = Math.floor(Number(qtyHeld))
      const res = await updateInventoryRow({
        packageId: initial.id,
        qty_available: qa,
        qty_held: qh,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Inventory updated.")
      router.refresh()
    })
  }

  function addInventoryRow() {
    start(async () => {
      const res = await insertPackageInventory(initial.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Inventory row created.")
      router.refresh()
    })
  }

  const raceLabel = races.find((r) => r.id === raceId)?.name ?? initial.race_name
  const qa = Math.floor(Number(qtyAvailable))
  const qh = Math.floor(Number(qtyHeld))
  const hasInventoryRow = initial.inventory != null
  const sellableLive =
    hasInventoryRow && Number.isFinite(qa) && Number.isFinite(qh) ? Math.max(0, qa - qh) : null
  const priceSummary = formatTradeSummary(currency, parsePrice(), isEnquiry)

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
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
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
            <span className="font-medium text-foreground truncate">{name || "Untitled"}</span>
            <span className="text-xs text-muted-foreground font-mono truncate">{initial.id}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {raceLabel}
            {circuit ? ` · ${circuit}` : ""}
            <span className="text-muted-foreground/80"> · {tier}</span>
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
        <div className="border-t border-border p-4 space-y-4 bg-card">
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-3 xl:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Race
                  <select
                    value={raceId}
                    onChange={(e) => setRaceId(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  >
                    {races.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.date_range})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Display name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Circuit / listing title
                  <input
                    value={circuit}
                    onChange={(e) => setCircuit(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Location
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Country
                  <input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Country code
                  <input
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="mt-1 w-full max-w-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Event date
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Date range label
                  <input
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Currency
                  <input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="mt-1 w-full max-w-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Total capacity
                  <input
                    value={totalCapacity}
                    onChange={(e) => setTotalCapacity(e.target.value)}
                    className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Tier
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  >
                    <option value="paddock">paddock</option>
                    <option value="champions">champions</option>
                    <option value="legend">legend</option>
                    <option value="hero">hero</option>
                  </select>
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Primary image URL
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                    placeholder="https://… or /images/…"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Extra gallery image URLs (one per line; shown after primary in portal carousel)
                  <textarea
                    value={galleryText}
                    onChange={(e) => setGalleryText(e.target.value)}
                    className="mt-1 w-full min-h-[72px] px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Description (portal)
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Package includes (one bullet per line)
                  <textarea
                    value={includesText}
                    onChange={(e) => setIncludesText(e.target.value)}
                    className="mt-1 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Trade price (blank if enquiry)
                  <input
                    value={tradePrice}
                    onChange={(e) => setTradePrice(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Sort order
                  <input
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Brochure URL (optional)
                  <input
                    value={brochureUrl}
                    onChange={(e) => setBrochureUrl(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={isEnquiry} onChange={(e) => setIsEnquiry(e.target.checked)} />
                  Enquiry package
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
                  Featured
                </label>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => savePackage()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Save package
              </button>
            </div>

            <div className="space-y-3 border-t xl:border-t-0 xl:border-l border-border pt-4 xl:pt-0 xl:pl-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inventory</p>
              {!initial.inventory ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No inventory row for this package yet.</p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => addInventoryRow()}
                    className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Create inventory row
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-muted-foreground">
                      Qty capacity
                      <input
                        value={qtyAvailable}
                        onChange={(e) => setQtyAvailable(e.target.value)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      Qty held
                      <input
                        value={qtyHeld}
                        onChange={(e) => setQtyHeld(e.target.value)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Held must stay at or below capacity. Adjust stock here; use the inventory page for agent holds.
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => saveInventory()}
                    className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Save inventory
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
