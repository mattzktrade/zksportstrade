"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createPackage } from "@/app/(admin)/actions"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"

function currencyHint(currency: string): string {
  const c = (currency || "USD").trim() || "USD"
  return `Amount in ${c}`
}

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

export function CatalogNewPackage({ races }: { races: AdminRaceOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [raceId, setRaceId] = useState(races[0]?.id ?? "")
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const [circuit, setCircuit] = useState("")
  const [location, setLocation] = useState("")
  const [country, setCountry] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [dateRange, setDateRange] = useState("")
  const [description, setDescription] = useState("")
  const [image, setImage] = useState("")
  const [galleryText, setGalleryText] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [totalCapacity, setTotalCapacity] = useState("30")
  const [duration, setDuration] = useState("")
  const [includesText, setIncludesText] = useState("Paddock Club Access\nPremium Dining")
  const [tradePrice, setTradePrice] = useState("")
  const [isEnquiry, setIsEnquiry] = useState(false)
  const [featured, setFeatured] = useState(false)
  const [sortOrder, setSortOrder] = useState("100")
  const [brochureUrl, setBrochureUrl] = useState("")
  const [initialQty, setInitialQty] = useState("0")
  const [initialUnitCost, setInitialUnitCost] = useState("")

  const selectedRace = races.find((r) => r.id === raceId)

  useEffect(() => {
    if (!selectedRace) return
    setLocation(selectedRace.location)
    setCountry(selectedRace.country)
    setCountryCode(selectedRace.country_code)
    setDateRange(selectedRace.date_range)
    setEventDate(String(selectedRace.event_date).slice(0, 10))
    setCircuit(selectedRace.short_name || selectedRace.name)
  }, [raceId, selectedRace])

  function parsePrice(): number | null {
    const t = tradePrice.trim()
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  function submit() {
    start(async () => {
      if (!raceId) {
        toast.error("Choose a race.")
        return
      }
      if (!id.trim()) {
        toast.error("Enter a package id (slug).")
        return
      }
      if (!name.trim()) {
        toast.error("Enter a package name.")
        return
      }
      const price = parsePrice()
      if (tradePrice.trim() !== "" && price === null) {
        toast.error("Trade price must be a number or empty.")
        return
      }
      const cap = Math.floor(Number(totalCapacity))
      if (!Number.isFinite(cap) || cap < 0) {
        toast.error("Total capacity must be a non-negative whole number.")
        return
      }
      const so = Math.floor(Number(sortOrder))
      if (!Number.isFinite(so)) {
        toast.error("Sort order must be a number.")
        return
      }
      const qty = Math.floor(Number(initialQty))
      if (!Number.isFinite(qty) || qty < 0) {
        toast.error("Initial stock must be a non-negative whole number.")
        return
      }
      let initialCost: number | null = null
      if (initialUnitCost.trim() !== "") {
        const c = Number(initialUnitCost)
        if (!Number.isFinite(c) || c < 0) {
          toast.error("Initial buy price must be a non-negative number.")
          return
        }
        initialCost = c
      }

      const res = await createPackage({
        id: id.trim(),
        race_id: raceId,
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
        duration,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        featured,
        sort_order: so,
        brochure_url: brochureUrl.trim() || null,
        initial_qty_available: qty,
        initial_unit_cost: initialCost,
        initial_cost_note: null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Package created.")
      setOpen(false)
      setId("")
      setName("")
      setTradePrice("")
      setInitialUnitCost("")
      router.refresh()
    })
  }

  if (races.length === 0) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
        Add at least one race in Supabase before creating packages.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">New package</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Creates a catalog row and inventory. Use a unique id (slug), e.g. <span className="font-mono">monaco-legend-2026</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
        >
          {open ? "Close" : "Create new package"}
        </button>
      </div>

      {open && (
        <div className="space-y-4 pt-2 border-t border-border">
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
                    {adminRaceLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Package id (slug) <span className="text-primary">*</span>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                placeholder="monaco-legend-2026"
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Display name <span className="text-primary">*</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Legend Paddock Club"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Circuit / listing title
              <input
                value={circuit}
                onChange={(e) => setCircuit(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
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
              Date range label (shown in portal)
              <input
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
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
                className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="AE"
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
              Total capacity (suite)
              <input
                value={totalCapacity}
                onChange={(e) => setTotalCapacity(e.target.value)}
                className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Package duration
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="mt-1 w-full max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm"
              >
                {PACKAGE_DURATION_OPTIONS.map((o) => (
                  <option key={o.value || "none"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Trade price (blank = enquiry / no firm price)
              <input
                value={tradePrice}
                onChange={(e) => setTradePrice(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              <span className="block text-[11px] text-muted-foreground/80 mt-1">{currencyHint(currency)}</span>
            </label>
            <label className="block text-xs text-muted-foreground">
              Sort order
              <input
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Initial stock (qty capacity)
              <input
                value={initialQty}
                onChange={(e) => setInitialQty(e.target.value)}
                className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Initial buy price (per unit)
              <input
                inputMode="decimal"
                value={initialUnitCost}
                onChange={(e) => setInitialUnitCost(e.target.value)}
                placeholder="Leave blank if unknown"
                className="mt-1 w-full max-w-[160px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              <span className="block text-[11px] text-muted-foreground/80 mt-1">
                {currencyHint(currency)}. Used as the cost basis for the initial batch. You can add more cost layers when
                restocking.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={isEnquiry} onChange={(e) => setIsEnquiry(e.target.checked)} />
              Enquiry package (no online checkout)
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              Featured
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Primary image URL
              <input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                placeholder="https://…"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Extra gallery image URLs (one per line)
              <textarea
                value={galleryText}
                onChange={(e) => setGalleryText(e.target.value)}
                className="mt-1 w-full min-h-[72px] px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                placeholder="https://…"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Description (portal package detail)
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
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              Brochure URL (optional)
              <input
                value={brochureUrl}
                onChange={(e) => setBrochureUrl(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                placeholder="https://…"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Create package
          </button>
        </div>
      )}
    </div>
  )
}
