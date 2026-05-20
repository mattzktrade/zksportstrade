"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  deletePackage,
  insertPackageInventory,
  updateInventoryRow,
  updatePackageFields,
} from "@/app/(admin)/actions"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { PACKAGE_DURATION_OPTIONS } from "@/lib/catalog/package-duration"
import { cn } from "@/lib/utils"
import { PackageCostLayers } from "@/components/admin/package-cost-layers"
import { PackagePortalVisibilityCheckbox } from "@/components/admin/package-portal-visibility"

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

function currencyHint(currency: string): string {
  const c = (currency || "USD").trim() || "USD"
  return `Amounts in ${c}`
}

export type PackageAdminPanelSection = "all" | "details" | "inventory"

export function PackageAdminPanel({
  initial,
  races,
  onDeleted,
  section = "all",
}: {
  initial: AdminPackageRow
  races: AdminRaceOption[]
  /** Called after successful delete (e.g. redirect from detail page). */
  onDeleted?: () => void
  /** Which block to show. Catalog expand uses `all`; product page uses separate tabs. */
  section?: PackageAdminPanelSection
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

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
  const [duration, setDuration] = useState(initial.duration ?? "")
  const [includesText, setIncludesText] = useState(includesToText(initial.includes))
  const [tradePrice, setTradePrice] = useState(initial.trade_price != null ? String(initial.trade_price) : "")
  const [isEnquiry, setIsEnquiry] = useState(initial.is_enquiry)
  const [featured, setFeatured] = useState(initial.featured)
  const [isHidden, setIsHidden] = useState(initial.is_hidden)
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order))
  const [brochureUrl, setBrochureUrl] = useState(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
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
    setDuration(initial.duration ?? "")
    setIncludesText(includesToText(initial.includes))
    setTradePrice(initial.trade_price != null ? String(initial.trade_price) : "")
    setIsEnquiry(initial.is_enquiry)
    setFeatured(initial.featured)
    setIsHidden(initial.is_hidden)
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
        duration,
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        featured,
        is_hidden: isHidden,
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

  function confirmDeletePackage() {
    if (
      !window.confirm(
        `Delete package “${name || initial.id}”? This cannot be undone. Packages with existing orders cannot be deleted.`,
      )
    ) {
      return
    }
    start(async () => {
      const res = await deletePackage(initial.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Package deleted.")
      if (onDeleted) onDeleted()
      else router.push("/admin/catalog")
      router.refresh()
    })
  }

  const showDetails = section === "all" || section === "details"
  const showInventory = section === "all" || section === "inventory"
  const salePrice = section === "inventory" ? initial.trade_price : parsePrice()

  return (
    <div className="space-y-6 min-w-0 w-full">
      {showDetails ? (
      <div className="space-y-3 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package details</p>
        <PackagePortalVisibilityCheckbox packageId={initial.id} isHidden={initial.is_hidden} className="mb-1" />
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
            Extra gallery image URLs (one per line)
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
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => savePackage()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Save package
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => confirmDeletePackage()}
            className="px-4 py-2 rounded-lg border border-red-500/40 text-red-600 text-sm font-medium hover:bg-red-500/10 disabled:opacity-50"
          >
            Delete package
          </button>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground">ID: {initial.id}</p>
      </div>
      ) : null}

      {showInventory ? (
      <div className={cn("space-y-4 min-w-0", showDetails && "border-t border-border pt-6")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inventory & cost</p>
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
            <PackageCostLayers
              packageId={initial.id}
              packageCurrency={(initial.currency || "USD").trim() || "USD"}
              salePrice={salePrice}
              layers={initial.cost_layers}
              qtyAvailable={initial.inventory.qty_available}
            />
            <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Manual capacity override
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md">
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
              <button
                type="button"
                disabled={pending}
                onClick={() => saveInventory()}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Save manual edit
              </button>
            </div>
          </>
        )}
      </div>
      ) : null}
    </div>
  )
}
