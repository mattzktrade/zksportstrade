"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createNativeEvent, createPackage } from "@/app/(admin)/actions"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import type { AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  isEventCategory,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { findPackageTemplate, PACKAGE_TEMPLATES } from "@/lib/catalog/package-templates"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"
import { CatalogImageField } from "@/components/admin/catalog-image-field"

const NEW_EVENT_ID = "__new__"

const NAME_PLACEHOLDERS: Record<EventCategory, string> = {
  formula_1: "3 Day Legend Paddock Club",
  tennis: "Centre Court Hospitality",
  football: "Hospitality suite",
  concert: "VIP experience",
  other: "Hospitality package",
}

function raceCategory(race: Pick<AdminRaceOption, "category"> | undefined): EventCategory {
  const value = String(race?.category ?? "")
  return isEventCategory(value) ? value : "formula_1"
}

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
  const formRef = useRef<HTMLDivElement>(null)
  const [pending, start] = useTransition()

  const [eventCategory, setEventCategory] = useState<EventCategory>("formula_1")
  const [templateId, setTemplateId] = useState("")
  const [raceId, setRaceId] = useState(races[0]?.id ?? "")
  const [newEventName, setNewEventName] = useState("")
  const [newEventShortName, setNewEventShortName] = useState("")
  const [newEventSeason, setNewEventSeason] = useState(new Date().getFullYear())
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
  const [isHidden, setIsHidden] = useState(false)
  const [brochureUrl, setBrochureUrl] = useState("")
  const [initialQty, setInitialQty] = useState("0")
  const [initialUnitCost, setInitialUnitCost] = useState("")
  const [initialSupplierAccountId, setInitialSupplierAccountId] = useState("")
  const [duration, setDuration] = useState("")
  const [inventoryIsStandalone, setInventoryIsStandalone] = useState(false)

  const isFormula1 = eventCategory === "formula_1"
  const creatingNewEvent = !isFormula1 && raceId === NEW_EVENT_ID
  const selectedRace = races.find((r) => r.id === raceId)
  const eventsForCategory = useMemo(
    () => races.filter((race) => raceCategory(race) === eventCategory),
    [eventCategory, races],
  )

  function applyRaceDefaults(race: AdminRaceOption) {
    setLocation(race.location)
    setCountry(race.country)
    setCountryCode(race.country_code)
    setDateRange(race.date_range)
    setEventDate(String(race.event_date).slice(0, 10))
    setCircuit(race.name)
  }

  function clearEventDefaults() {
    setCircuit("")
    setLocation("")
    setCountry("")
    setCountryCode("")
    setEventDate("")
    setDateRange("")
  }

  function resetForm() {
    const firstF1 = races.find((race) => raceCategory(race) === "formula_1") ?? races[0]
    setEventCategory("formula_1")
    setTemplateId("")
    setRaceId(firstF1?.id ?? "")
    setNewEventName("")
    setNewEventShortName("")
    setNewEventSeason(new Date().getFullYear())
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
    setIsHidden(false)
    setBrochureUrl("")
    setInitialQty("0")
    setInitialUnitCost("")
    setInitialSupplierAccountId("")
    setDuration("")
    setInventoryIsStandalone(false)
    if (firstF1) applyRaceDefaults(firstF1)
    else clearEventDefaults()
  }

  function selectCategory(next: EventCategory) {
    setEventCategory(next)
    setTemplateId("")
    if (next !== "formula_1") {
      setDuration("")
      setInventoryIsStandalone(false)
    }
    const matching = races.filter((race) => raceCategory(race) === next)
    if (matching[0]) {
      setRaceId(matching[0].id)
      applyRaceDefaults(matching[0])
      return
    }
    if (next === "formula_1") {
      setRaceId("")
      clearEventDefaults()
      return
    }
    setRaceId(NEW_EVENT_ID)
    clearEventDefaults()
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
    if (!open) return
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [open])

  useEffect(() => {
    if (isEnquiry || isHidden) {
      setSellOnWix(false)
      setWixMultiplier("")
      setWixManualPrice("")
    }
  }, [isEnquiry, isHidden])

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
      if (isFormula1 && !raceId) {
        toast.error("Choose a race.")
        return
      }
      if (!isFormula1 && !creatingNewEvent && !raceId) {
        toast.error("Choose an event.")
        return
      }
      if (creatingNewEvent) {
        if (!newEventName.trim() || !newEventShortName.trim()) {
          toast.error("Enter the event name and short name.")
          return
        }
        if (!location.trim() || !country.trim() || !countryCode.trim()) {
          toast.error("Location, country, and country code are required for a new event.")
          return
        }
        if (!eventDate.trim() || !dateRange.trim()) {
          toast.error("Event date and date range are required for a new event.")
          return
        }
      }
      if (!name.trim()) {
        toast.error("Enter a display name.")
        return
      }
      if (isFormula1 && !duration.trim()) {
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
      if (qty > 0 && !initialSupplierAccountId) {
        toast.error("Select a company as the source.")
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

      let packageRaceId = raceId
      if (creatingNewEvent) {
        const eventRes = await createNativeEvent({
          category: eventCategory,
          name: newEventName.trim(),
          shortName: newEventShortName.trim(),
          location: location.trim(),
          country: country.trim(),
          countryCode: countryCode.trim(),
          eventDate: eventDate.trim(),
          dateRange: dateRange.trim(),
          image: image.trim(),
          season: newEventSeason,
        })
        if (!eventRes.ok || !eventRes.eventId) {
          toast.error(eventRes.ok ? "Event was created but its ID was missing." : eventRes.message)
          return
        }
        packageRaceId = eventRes.eventId
      }

      const res = await createPackage({
        race_id: packageRaceId,
        name: name.trim(),
        circuit: circuit.trim() || newEventName.trim() || name.trim(),
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
        inventory_is_standalone: inventoryIsStandalone,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        requires_booking_approval: requiresBookingApproval,
        featured,
        is_hidden: isHidden,
        sort_order: 100,
        brochure_url: brochureUrl.trim() || null,
        sell_on_wix: sellOnWix,
        retail_price_multiplier: mult,
        wix_retail_price: manualWix,
        initial_qty_available: qty,
        initial_unit_cost: initialCost,
        initial_cost_note: null,
        initial_supplier_account_id: initialSupplierAccountId || null,
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

  if (!open) return null

  const noF1Events = isFormula1 && eventsForCategory.length === 0

  return (
    <div
      id="admin-new-package"
      ref={formRef}
      className="scroll-mt-20 rounded-xl border border-border bg-card p-5 sm:p-6 shadow-sm space-y-6"
    >
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
          Event type
          <select
            value={eventCategory}
            onChange={(e) => selectCategory(e.target.value as EventCategory)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {EVENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {EVENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-muted-foreground/80 mt-1">
            Formula 1 keeps race templates and day-split inventory. Other types are for tennis, football, concerts, and similar events.
          </span>
        </label>

        {isFormula1 ? (
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
        ) : null}

        {noF1Events ? (
          <p className="sm:col-span-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-4">
            Add at least one Formula 1 event under Inventory → Events before creating F1 packages.
          </p>
        ) : (
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            {isFormula1 ? "Race" : "Event"}
            <select
              value={raceId}
              onChange={(e) => {
                const next = e.target.value
                setRaceId(next)
                if (next === NEW_EVENT_ID) clearEventDefaults()
              }}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {eventsForCategory.map((r) => (
                <option key={r.id} value={r.id}>
                  {adminRaceLabel(r)}
                </option>
              ))}
              {!isFormula1 ? <option value={NEW_EVENT_ID}>Create new event…</option> : null}
            </select>
            {!isFormula1 ? (
              <span className="block text-[11px] text-muted-foreground/80 mt-1">
                Choose an existing {EVENT_CATEGORY_LABELS[eventCategory].toLowerCase()} event, or create one here if it is not in the list yet.
              </span>
            ) : null}
          </label>
        )}

        {creatingNewEvent ? (
          <>
            <label className="block text-xs text-muted-foreground">
              Event name <span className="text-primary">*</span>
              <input
                value={newEventName}
                onChange={(e) => {
                  const value = e.target.value
                  setNewEventName(value)
                  if (!circuit.trim()) setCircuit(value)
                }}
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="2026 Wimbledon Championships"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Short name <span className="text-primary">*</span>
              <input
                value={newEventShortName}
                onChange={(e) => setNewEventShortName(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="Wimbledon"
              />
            </label>
            <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
              Season
              <input
                type="number"
                min={2020}
                max={2100}
                value={newEventSeason}
                onChange={(e) => setNewEventSeason(Number(e.target.value))}
                className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
          </>
        ) : null}

        <label className="block text-xs text-muted-foreground sm:col-span-2">
          Display name <span className="text-primary">*</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder={NAME_PLACEHOLDERS[eventCategory]}
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-md">
          {isFormula1 ? (
            <>
              Duration (linked day splits) <span className="text-primary">*</span>
            </>
          ) : (
            "Duration (optional)"
          )}
          <select
            required={isFormula1}
            value={duration}
            onChange={(e) => {
              const next = e.target.value
              setDuration(next)
              if (!next || next === "3_day") setInventoryIsStandalone(false)
            }}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {PACKAGE_DURATION_OPTIONS.map((o) => (
              <option key={o.value || "none"} value={o.value} disabled={isFormula1 && o.value === ""}>
                {o.label}
              </option>
            ))}
          </select>
          {isFormula1 && duration && duration !== "3_day" ? (
            <label className="mt-2 flex items-start gap-2 rounded-md border border-border p-2.5 text-[11px] leading-relaxed">
              <input
                type="checkbox"
                checked={inventoryIsStandalone}
                onChange={(e) => setInventoryIsStandalone(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Separate inventory.</strong> Use this when this day package was purchased
                independently rather than taken from the linked 3-day stock.
              </span>
            </label>
          ) : null}
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/90">
            {isFormula1
              ? "Saturday only, Sunday only, and 3-day options with the same product stem share inventory (e.g. Velocity Terrace splits)."
              : "Leave unspecified unless this product has day or session splits that should share inventory."}
          </span>
        </label>

        <label className="block text-xs text-muted-foreground">
          {isFormula1 ? "Circuit / listing title" : "Venue / listing title"}
          <input
            value={circuit}
            onChange={(e) => setCircuit(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder={isFormula1 ? undefined : "All England Lawn Tennis Club"}
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
            placeholder={isFormula1 ? undefined : "29 Jun – 12 Jul"}
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder={isFormula1 ? undefined : "London"}
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Country
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder={isFormula1 ? undefined : "United Kingdom"}
          />
        </label>

        <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
          Country code
          <input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder={isFormula1 ? "AE" : "GB"}
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
            <div className="mt-1.5">
              <CompanySupplierSelect
                value={initialSupplierAccountId}
                onChange={setInitialSupplierAccountId}
              />
            </div>
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
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={isHidden}
            onChange={(e) => setIsHidden(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Hidden on portal
            <span className="block text-[11px] text-muted-foreground/80">
              Keep this product off the agent portal and website. Use this for internal stock such as parking passes.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={sellOnWix}
            onChange={(e) => setSellOnWix(e.target.checked)}
            disabled={isEnquiry || isHidden}
          />
          Sell on Wix website
        </label>
        {sellOnWix && !isEnquiry && !isHidden ? (
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
        <CatalogImageField
          className="sm:col-span-2"
          label="Primary image"
          value={image}
          onChange={setImage}
        />
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
        disabled={pending || noF1Events}
        onClick={() => submit()}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
      >
        Create package
      </button>
    </div>
  )
}
