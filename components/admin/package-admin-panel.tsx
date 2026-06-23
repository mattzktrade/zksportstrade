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
import type { LinkedInventoryPackage } from "@/lib/admin/linked-inventory"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { cn } from "@/lib/utils"
import { PackageCostLayers } from "@/components/admin/package-cost-layers"
import { PackagePortalVisibilityCheckbox } from "@/components/admin/package-portal-visibility"
import { PackageIntegrationPanel } from "@/components/admin/package-integration-panel"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"

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

export type PackageAdminPanelSection = "all" | "details" | "inventory" | "integrations"

export function PackageAdminPanel({
  initial,
  races,
  wixListings = [],
  linkedPackages = [],
  onDeleted,
  section = "all",
}: {
  initial: AdminPackageRow
  races: AdminRaceOption[]
  wixListings?: WixChannelListingRow[]
  linkedPackages?: LinkedInventoryPackage[]
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
  const [totalCapacity, setTotalCapacity] = useState(String(initial.total_capacity))
  const [includesText, setIncludesText] = useState(includesToText(initial.includes))
  const [tradePrice, setTradePrice] = useState(initial.trade_price != null ? String(initial.trade_price) : "")
  const [isEnquiry, setIsEnquiry] = useState(initial.is_enquiry)
  const [requiresBookingApproval, setRequiresBookingApproval] = useState(
    initial.requires_booking_approval ?? false,
  )
  const [featured, setFeatured] = useState(initial.featured)
  const [isHidden, setIsHidden] = useState(initial.is_hidden)
  const [brochureUrl, setBrochureUrl] = useState(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
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
    setTotalCapacity(String(initial.total_capacity))
    setIncludesText(includesToText(initial.includes))
    setTradePrice(initial.trade_price != null ? String(initial.trade_price) : "")
    setIsEnquiry(initial.is_enquiry)
    setRequiresBookingApproval(initial.requires_booking_approval ?? false)
    setFeatured(initial.featured)
    setIsHidden(initial.is_hidden)
    setBrochureUrl(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
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
        currency: (initial.currency || "USD").trim() || "USD",
        total_capacity: cap,
        duration: initial.duration ?? "",
        includes: linesToList(includesText),
        trade_price: price,
        is_enquiry: isEnquiry,
        requires_booking_approval: requiresBookingApproval,
        featured,
        is_hidden: isHidden,
        sort_order: initial.sort_order,
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

  function saveHeld() {
    start(async () => {
      const qa = initial.inventory?.qty_available ?? 0
      const qh = Math.floor(Number(qtyHeld))
      if (!Number.isFinite(qh) || qh < 0) {
        toast.error("Held quantity must be a non-negative whole number.")
        return
      }
      const res = await updateInventoryRow({
        packageId: initial.id,
        qty_available: qa,
        qty_held: qh,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(
        linkedPackages.length > 1 ? "Hold updated across linked packages." : "Held quantity updated.",
      )
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
        `Delete package “${name || initial.id}”? This removes the portal listing and deletes the linked Wix and Salesforce products. Packages with existing orders cannot be deleted.`,
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
      toast.success(res.message ?? "Package deleted.", { duration: res.message ? 10000 : 4000 })
      if (onDeleted) onDeleted()
      else router.push("/admin/catalog")
      router.refresh()
    })
  }

  const showDetails = section === "all" || section === "details"
  const showInventory = section === "all" || section === "inventory"
  const showIntegrations = section === "all" || section === "integrations"
  const salePrice = section === "inventory" || section === "all" ? initial.trade_price : parsePrice()
  const qtyAvailable = initial.inventory?.qty_available ?? 0
  const qtyHeldNum = initial.inventory?.qty_held ?? 0
  const sellable = Math.max(0, qtyAvailable - qtyHeldNum)
  const soldTotal = initial.sales_breakdown?.total ?? 0

  return (
    <div className="space-y-6 min-w-0 w-full">
      {showDetails ? (
      <div className="space-y-3 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package details</p>
        <PackagePortalVisibilityCheckbox packageId={initial.id} isHidden={initial.is_hidden} className="mb-1" />
        <div className="grid gap-4 sm:grid-cols-2">
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
          <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
            Country code
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
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
            Date range label
            <input
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground sm:col-span-2 sm:max-w-xs">
            Total capacity
            <input
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            Primary image URL
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
              placeholder="https://… or /images/…"
            />
            <span className="block text-[11px] text-muted-foreground/80 mt-1 leading-relaxed">
              Wix and other CDN thumbnail links are upgraded to full size on save and in the portal.
            </span>
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
            <span className="block text-[11px] text-muted-foreground/80 mt-1">
              {currencyHint((initial.currency || "USD").trim() || "USD")}
            </span>
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
            <input
              type="checkbox"
              checked={requiresBookingApproval}
              onChange={(e) => setRequiresBookingApproval(e.target.checked)}
            />
            Requires booking approval (Paddock Club)
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
            className="px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 disabled:opacity-50"
          >
            Delete package
          </button>
        </div>
      </div>
      ) : null}

      {showIntegrations ? (
        <div className={cn(showDetails && section === "all" && "border-t border-border pt-6")}>
          <PackageIntegrationPanel initial={initial} wixListings={wixListings} compact={section === "all"} />
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sellable</p>
                <p className="text-lg font-semibold tabular-nums">{sellable}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">On hold</p>
                <p className="text-lg font-semibold tabular-nums">{qtyHeldNum}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock</p>
                <p className="text-lg font-semibold tabular-nums">{qtyAvailable}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sold</p>
                <p className="text-lg font-semibold tabular-nums">{soldTotal}</p>
              </div>
            </div>
            <PackageCostLayers
              packageId={initial.id}
              packageName={initial.name}
              packageDuration={initial.duration}
              packageCurrency={(initial.currency || "USD").trim() || "USD"}
              salePrice={salePrice}
              layers={initial.cost_layers}
              salesBreakdown={initial.sales_breakdown}
              linkedPackages={linkedPackages}
              sellable={sellable}
            />
            <div className="rounded-lg border border-dashed border-border p-3 space-y-3 max-w-xs">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Manual hold</p>
              {linkedPackages.length > 1 ? (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Applies to all linked packages in this group (Saturday, Sunday, multi-day).
                </p>
              ) : null}
              <label className="block text-xs text-muted-foreground">
                Qty on hold
                <input
                  value={qtyHeld}
                  onChange={(e) => setQtyHeld(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={() => saveHeld()}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Save hold
              </button>
            </div>
          </>
        )}
      </div>
      ) : null}
    </div>
  )
}
