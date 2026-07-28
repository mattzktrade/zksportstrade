"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createPackage } from "@/app/(admin)/actions"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { findPackageTemplate, PACKAGE_TEMPLATES } from "@/lib/catalog/package-templates"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

export function CatalogNewPackage({
  races,
  open,
  onOpenChange,
  onCreated,
}: {
  races: AdminRaceOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [templateId, setTemplateId] = useState("")
  const [raceId, setRaceId] = useState(races[0]?.id ?? "")
  const [sellOnWix, setSellOnWix] = useState(false)
  const [wixMultiplier, setWixMultiplier] = useState("")
  const [wixManualPrice, setWixManualPrice] = useState("")
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
  const [totalCapacity, setTotalCapacity] = useState("150")
  const [includesText, setIncludesText] = useState("")
  const [tradePrice, setTradePrice] = useState("")
  const [isEnquiry, setIsEnquiry] = useState(false)
  const [requiresBookingApproval, setRequiresBookingApproval] = useState(false)
  const [featured, setFeatured] = useState(false)
  const [brochureUrl, setBrochureUrl] = useState("")
  const [initialQty, setInitialQty] = useState("0")
  const [initialUnitCost, setInitialUnitCost] = useState("")
  const [initialSource, setInitialSource] = useState("")
  const [duration, setDuration] = useState("")
  const [inventoryGroupId, setInventoryGroupId] = useState("")

  const selectedRace = races.find((r) => r.id === raceId)

  function applyRaceDefaults(race: AdminRaceOption) {
    setLocation(race.location)
    setCountry(race.country)
    setCountryCode(race.country_code)
    setDateRange(race.date_range)
    setEventDate(String(race.event_date).slice(0, 10))
    setCircuit(race.name)
  }

  function resetForm() {
    const firstRace = races[0]
    setTemplateId("")
    setRaceId(firstRace?.id ?? "")
    setSellOnWix(false)
    setWixMultiplier("")
    setWixManualPrice("")
    setName("")
    setDescription("")
    setImage("")
    setGalleryText("")
    setTotalCapacity("150")
    setIncludesText("")
    setTradePrice("")
    setIsEnquiry(false)
    setRequiresBookingApproval(false)
    setFeatured(false)
    setBrochureUrl("")
    setInitialQty("0")
    setInitialUnitCost("")
    setInitialSource("")
    setDuration("")
    setInventoryGroupId("")
    if (firstRace) applyRaceDefaults(firstRace)
    else {
      setCircuit("")
      setLocation("")
      setCountry("")
      setCountryCode("")
      setEventDate("")
      setDateRange("")
    }
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (!id) return
    const t = findPackageTemplate(id)
    if (!t) return
    setName(t.nameSuffix)
    setDescription(t.description)
    setIncludesText(t.includes.join("\n"))
    setTotalCapacity(String(t.totalCapacity))
    if (t.requiresBookingApproval != null) {
      setRequiresBookingApproval(t.requiresBookingApproval)
      setIsEnquiry(t.requiresBookingApproval)
    }
  }

  useEffect(() => {
    if (isEnquiry) {
      setSellOnWix(false)
      setWixMultiplier("")
      setWixManualPrice("")
    }
  }, [isEnquiry])

  useEffect(() => {
    if (!selectedRace) return
    applyRaceDefaults(selectedRace)
  }, [raceId, selectedRace])

  useEffect(() => {
    if (open) resetForm()
  }, [open])

  function parsePrice(): number | null {
    const t = tradePrice.trim()
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const tradePriceNumber = parsePrice()
  const wixPreviewPrice = (() => {
    if (!sellOnWix) return null
    const manual = wixManualPrice.trim() === "" ? null : Number(wixManualPrice)
    if (manual != null && Number.isFinite(manual) && manual >= 0) {
      return Math.round(manual * 100) / 100
    }
    if (tradePriceNumber == null) return null
    const multRaw = wixMultiplier.trim() === "" ? 1.1 : Number(wixMultiplier)
    const mult = Number.isFinite(multRaw) && multRaw > 0 ? multRaw : 1.1
    return Math.round(tradePriceNumber * mult * 100) / 100
  })()

  function submit() {
    start(async () => {
      if (!raceId) {
        toast.error("Choose a race.")
        return
      }
      if (!name.trim()) {
        toast.error("Enter a display name.")
        return
      }
      if (!duration.trim()) {
        toast.error("Choose a duration (linked day splits).")
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

      let mult: number | null = null
      if (sellOnWix && wixMultiplier.trim() !== "") {
        const n = Number(wixMultiplier)
        if (!Number.isFinite(n) || n <= 0) {
          toast.error("Wix price multiplier must be a positive number (e.g. 1.1).")
          return
        }
        mult = n
      }
      let manualWix: number | null = null
      if (sellOnWix && wixManualPrice.trim() !== "") {
        const n = Number(wixManualPrice)
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Manual Wix price must be zero or a positive number.")
          return
        }
        manualWix = n
      }
      if (sellOnWix && !isEnquiry && price == null && manualWix == null) {
        toast.error("Sell on Wix needs a trade price or a manual Wix price.")
        return
      }

      const res = await createPackage({
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
        currency: "USD",
        total_capacity: cap,
        duration,
        inventory_group_id: inventoryGroupId.trim() || null,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        requires_booking_approval: requiresBookingApproval,
        featured,
        sort_order: 100,
        brochure_url: brochureUrl.trim() || null,
        sell_on_wix: sellOnWix,
        retail_price_multiplier: mult,
        wix_retail_price: manualWix,
        initial_qty_available: qty,
        initial_unit_cost: initialCost,
        initial_cost_note: null,
        initial_source: initialSource.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const msg = res.message ?? "Package created."
      if (/Wix product was not created|Wix API is not configured/i.test(msg)) {
        toast.message(msg, { duration: 12000 })
      } else {
        toast.success(msg, { duration: 8000 })
      }
      resetForm()
      onCreated?.()
      onOpenChange(false)
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

  if (!open) return null

  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">New package</h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Template (optional)
          <select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="">Start from scratch</option>
            {PACKAGE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-muted-foreground/80 mt-1">
            Prefills name, description, inclusions, and capacity for recurring hospitality products.
          </span>
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Race
          <select
            value={raceId}
            onChange={(e) => setRaceId(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {adminRaceLabel(r)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Display name <span className="text-primary">*</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder="3 Day Legend Paddock Club"
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-md">
          Duration (linked day splits) <span className="text-primary">*</span>
          <select
            required
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {PACKAGE_DURATION_OPTIONS.map((o) => (
              <option key={o.value || "none"} value={o.value} disabled={o.value === ""}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/90">
            Saturday only, Sunday only, and 3-day options with the same product stem share inventory (e.g. Velocity
            Terrace splits).
          </span>
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-md">
          Linked inventory key
          <input
            value={inventoryGroupId}
            onChange={(e) => setInventoryGroupId(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            placeholder="Leave blank to auto-link, e.g. abudhabi-2026/velocity-terrace"
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/90">
            Use the same key for the 3 day, 2 day, Saturday, Sunday, and Friday versions when they share one stock pool.
          </span>
        </label>

        <label className="block text-xs text-muted-foreground">
          Circuit / listing title
          <input
            value={circuit}
            onChange={(e) => setCircuit(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Event date
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Date range label (shown in portal)
          <input
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Country
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
          Country code
          <input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder="AE"
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
          Total capacity (suite)
          <input
            value={totalCapacity}
            onChange={(e) => setTotalCapacity(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing &amp; stock</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs text-muted-foreground">
            Trade price (USD)
            <input
              value={tradePrice}
              onChange={(e) => setTradePrice(e.target.value)}
              placeholder="Blank = enquiry"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Initial stock
            <input
              value={initialQty}
              onChange={(e) => setInitialQty(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Buy price (per unit)
            <input
              inputMode="decimal"
              value={initialUnitCost}
              onChange={(e) => setInitialUnitCost(e.target.value)}
              placeholder="Optional"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Source
            <input
              value={initialSource}
              onChange={(e) => setInitialSource(e.target.value)}
              placeholder="e.g. F1 Direct"
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={isEnquiry} onChange={(e) => setIsEnquiry(e.target.checked)} />
          Enquiry package (no online checkout)
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={requiresBookingApproval}
            onChange={(e) => setRequiresBookingApproval(e.target.checked)}
          />
          Requires booking approval
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          Featured
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={sellOnWix}
            onChange={(e) => setSellOnWix(e.target.checked)}
            disabled={isEnquiry}
          />
          Sell on Wix website
        </label>
        {sellOnWix && !isEnquiry ? (
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Wix website pricing
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Creating this package will also create the product on Wix Stores using the price below.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">
                Wix price multiplier
                <input
                  value={wixMultiplier}
                  onChange={(e) => setWixMultiplier(e.target.value)}
                  placeholder="Default 1.10 (+10%)"
                  className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Manual Wix price (USD)
                <input
                  value={wixManualPrice}
                  onChange={(e) => setWixManualPrice(e.target.value)}
                  placeholder="Leave blank to use multiplier"
                  className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </label>
            </div>
            {wixPreviewPrice != null ? (
              <p className="text-[11px] text-muted-foreground">
                Wix listing price ≈{" "}
                <span className="font-medium text-foreground">
                  {wixPreviewPrice.toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </span>
                {wixManualPrice.trim() ? " (manual)" : " (trade × multiplier)"}
              </p>
            ) : (
              <p className="text-[11px] text-amber-800">
                Enter a trade price or a manual Wix price to create the Wix product.
              </p>
            )}
          </div>
        ) : null}
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Primary image URL
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            placeholder="https://…"
          />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Extra gallery image URLs (one per line)
          <textarea
            value={galleryText}
            onChange={(e) => setGalleryText(e.target.value)}
            className="mt-1.5 w-full min-h-[72px] px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
            placeholder="https://…"
          />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Description (portal package detail)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Package includes (one bullet per line)
          <textarea
            value={includesText}
            onChange={(e) => setIncludesText(e.target.value)}
            className="mt-1.5 w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Brochure URL (optional)
          <input
            value={brochureUrl}
            onChange={(e) => setBrochureUrl(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
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
  )
}
