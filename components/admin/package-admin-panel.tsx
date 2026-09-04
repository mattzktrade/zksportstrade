"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  deletePackage,
  insertPackageInventory,
  updatePackageFields,
} from "@/app/(admin)/actions"
import type { LinkedInventoryPackage, LinkedInventoryShellPackage } from "@/lib/admin/linked-inventory"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import type { LinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { cn } from "@/lib/utils"
import { PackageCostLayers } from "@/components/admin/package-cost-layers"
import { PackagePortalVisibilityCheckbox } from "@/components/admin/package-portal-visibility"
import { PackageIntegrationPanel } from "@/components/admin/package-integration-panel"
import { PackageBrochureActions } from "@/components/admin/package-brochure-actions"
import { LinkedDayInventoryToolbar } from "@/components/admin/linked-day-packages-panel"
import { FulfilmentBlocksPanel } from "@/components/admin/fulfilment-blocks-panel"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"
import type { FulfilmentBlockWithUsage } from "@/lib/admin/fulfilment-blocks"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import {
  commitmentSellable,
  linkedPoolClosedWonRemaining,
  linkedPoolSellableForPackage,
  type LinkedSellableMember,
} from "@/lib/admin/package-sales-breakdown"
import { PACKAGE_DURATION_OPTIONS, packageDurationLabel } from "@/lib/catalog/package-duration"

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

export type PackageAdminPanelSection = "all" | "details" | "inventory" | "visibility" | "integrations"

export function PackageAdminPanel({
  initial,
  races,
  wixListings = [],
  linkedPackages = [],
  linkedShellPackages = [],
  linkedDayOverview,
  onDeleted,
  section = "all",
  purchaseOrders = [],
  fulfilmentBlocks = [],
  onInventoryChanged,
}: {
  initial: AdminPackageRow
  races: AdminRaceOption[]
  wixListings?: WixChannelListingRow[]
  linkedPackages?: LinkedInventoryPackage[]
  linkedShellPackages?: LinkedInventoryShellPackage[]
  linkedDayOverview?: LinkedDayPackageOverview
  /** Called after successful delete (e.g. redirect from detail page). */
  onDeleted?: () => void
  /** Which block to show. Catalog expand uses `all`; product page uses separate tabs. */
  section?: PackageAdminPanelSection
  /** All portal purchase orders — layer editor uses these to link a PO to a cost layer. */
  purchaseOrders?: PurchaseOrderRow[]
  /** Fulfilment blocks for this package (with usage counts). */
  fulfilmentBlocks?: FulfilmentBlockWithUsage[]
  /** Refetch inventory after cost-layer mutations. */
  onInventoryChanged?: () => Promise<void> | void
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
  const [duration, setDuration] = useState(initial.duration ?? "")
  const [inventoryGroupId, setInventoryGroupId] = useState(initial.inventory_group_id ?? "")
  const [inventoryIsStandalone, setInventoryIsStandalone] = useState(
    initial.inventory_is_standalone ?? false,
  )
  const [isEnquiry, setIsEnquiry] = useState(initial.is_enquiry)
  const [requiresBookingApproval, setRequiresBookingApproval] = useState(
    initial.requires_booking_approval ?? false,
  )
  const [featured, setFeatured] = useState(initial.featured)
  const [isHidden, setIsHidden] = useState(initial.is_hidden)
  const [brochureUrl, setBrochureUrl] = useState(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
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
    setDuration(initial.duration ?? "")
    setInventoryGroupId(initial.inventory_group_id ?? "")
    setInventoryIsStandalone(initial.inventory_is_standalone ?? false)
    setIsEnquiry(initial.is_enquiry)
    setRequiresBookingApproval(initial.requires_booking_approval ?? false)
    setFeatured(initial.featured)
    setIsHidden(initial.is_hidden)
    setBrochureUrl(typeof initial.brochure_url === "string" ? initial.brochure_url : "")
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
        duration,
        inventory_group_id: inventoryGroupId.trim() || null,
        inventory_is_standalone: inventoryIsStandalone,
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
        `Delete package “${name || initial.id}”? This removes the portal listing and the linked website product. Packages with existing orders cannot be deleted.`,
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
  const showIntegrations = section === "all" || section === "visibility" || section === "integrations"
  const salePrice = section === "inventory" || section === "all" ? initial.trade_price : parsePrice()
  const qtyAvailable = initial.inventory?.qty_available ?? 0
  const qtyHeldNum = initial.canonical_availability?.reserved ?? initial.inventory?.qty_held ?? 0
  const inventorySellable = Math.max(0, qtyAvailable - qtyHeldNum)
  const salesBreakdown = initial.sales_breakdown ?? {
    package_id: initial.id,
    wix: 0,
    salesforceOffline: 0,
    salesforceOpenPipeline: 0,
    unsignedOpenPipeline: 0,
    tradePortal: 0,
    total: 0,
  }
  const soldTotal = salesBreakdown.total
  const layerStock = (initial.cost_layers ?? []).reduce(
    (sum, l) => sum + Math.max(0, Math.floor(Number(l.quantity) || 0)),
    0,
  )
  const stockDisplay =
    initial.canonical_availability?.bought ??
    (layerStock > 0 ? layerStock : Math.max(qtyAvailable, layerStock))
  const linkedMembers: LinkedSellableMember[] =
    linkedPackages.length > 1
      ? linkedPackages.map((p) => ({
          id: p.id,
          duration: p.duration,
          breakdown: p.id === initial.id ? salesBreakdown : p.sales_breakdown,
        }))
      : []
  // Per-package pool Remaining (Fri ≠ Sun ≠ 3-day). Do not sum every sibling's pipeline.
  const calculatedSellable =
    linkedMembers.length > 0
      ? linkedPoolSellableForPackage({
          stock: stockDisplay,
          targetId: initial.id,
          targetDuration: initial.duration ?? null,
          members: linkedMembers,
        })
      : commitmentSellable({
          stock: stockDisplay,
          breakdown: salesBreakdown,
        })
  const linkedSoldRemaining =
    linkedMembers.length > 0
      ? linkedPoolClosedWonRemaining({
          stock: stockDisplay,
          targetId: initial.id,
          targetDuration: initial.duration ?? null,
          members: linkedMembers,
        })
      : null
  const soldDisplay =
    linkedSoldRemaining == null
      ? soldTotal
      : Math.max(0, stockDisplay - linkedSoldRemaining)
  const sellable = Math.max(
    0,
    calculatedSellable - qtyHeldNum,
  )
  const netStock = Math.floor(
    linkedMembers.length > 0
      ? (linkedSoldRemaining ?? stockDisplay - soldDisplay)
      : initial.effective_net ?? calculatedSellable,
  )
  const ownedShortage = initial.canonical_availability
    ? Math.max(initial.canonical_availability.historicalShortage, -netStock, 0)
    : Math.max(soldDisplay - stockDisplay, 0)
  const pipelineOversubscription = Math.max(0, -calculatedSellable - ownedShortage)
  const openPipelineHolds =
    linkedMembers.length > 0
      ? linkedMembers.reduce((sum, m) => sum + Math.max(0, Math.floor(m.breakdown.salesforceOpenPipeline)), 0)
      : Math.max(0, Math.floor(salesBreakdown.salesforceOpenPipeline))

  const editingEvent = races.find((r) => r.id === raceId)
  const isFormula1Event = (editingEvent?.category ?? "formula_1") === "formula_1"

  return (
    <div className="space-y-6 min-w-0 w-full">
      {showDetails ? (
      <div className="space-y-4 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package details</p>
        <PackagePortalVisibilityCheckbox packageId={initial.id} isHidden={initial.is_hidden} className="mb-1" />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            {isFormula1Event ? "Race" : "Event"}
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
            {isFormula1Event ? "Circuit / listing title" : "Venue / listing title"}
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
          <label className="block text-xs text-muted-foreground">
            Package type / duration
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {PACKAGE_DURATION_OPTIONS.map((option) => (
                <option key={option.value || "none"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-muted-foreground/80 mt-1">
              Current: {packageDurationLabel(initial.duration) ?? "Not specified"}
            </span>
          </label>
          <label className="block text-xs text-muted-foreground">
            Linked inventory key
            <input
              value={inventoryGroupId}
              onChange={(e) => setInventoryGroupId(e.target.value)}
              disabled={inventoryIsStandalone}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
              placeholder={inventoryIsStandalone ? "Standalone inventory" : "Auto-generated when blank"}
            />
            <span className="block text-[11px] text-muted-foreground/80 mt-1 leading-relaxed">
              Packages with the same key share inventory.
            </span>
            <span className="mt-2 flex items-start gap-2 rounded-md border border-border p-2.5 text-[11px] leading-relaxed">
              <input
                type="checkbox"
                checked={inventoryIsStandalone}
                onChange={(e) => setInventoryIsStandalone(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong className="text-foreground">Use separate inventory for this package.</strong>{" "}
                Select this when the day package was purchased independently and should not consume the
                3-day stock.
              </span>
            </span>
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
          <div className="sm:col-span-2 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Sales brochure</p>
                <p className="mt-1 text-xs text-muted-foreground leading-5">
                  Creates a ZK-branded PDF from this product&apos;s photos, description and inclusions.
                  Only the ZK team can generate it — portal clients just download the finished file.
                </p>
              </div>
              <PackageBrochureActions
                packageId={initial.id}
                brochureUrl={brochureUrl.trim() || null}
                productName={name.trim() || initial.name}
                onUrlChange={(url) => setBrochureUrl(url)}
              />
            </div>
            <label className="block text-xs text-muted-foreground">
              Custom brochure URL (optional)
              <input
                value={brochureUrl}
                onChange={(e) => setBrochureUrl(e.target.value)}
                placeholder="https://"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
              />
            </label>
          </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-3xl">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sellable</p>
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    ownedShortage > 0 || pipelineOversubscription > 0 ? "text-destructive" : ""
                  }`}
                >
                  {sellable}
                </p>
                {ownedShortage > 0 ? (
                  <p className="text-[10px] text-destructive/90 mt-0.5">
                    {ownedShortage} sold place{ownedShortage === 1 ? "" : "s"} not covered
                  </p>
                ) : pipelineOversubscription > 0 ? (
                  <p className="text-[10px] text-destructive/90 mt-0.5">
                    Pipeline exceeds stock by {pipelineOversubscription}
                  </p>
                ) : openPipelineHolds > 0 ? (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    After signed contracts
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">On hold</p>
                <p className="text-lg font-semibold tabular-nums">{qtyHeldNum}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Net stock</p>
                <p className={`text-lg font-semibold tabular-nums ${netStock < 0 ? "text-destructive" : ""}`}>
                  {netStock}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Stock
                </p>
                <p className="text-lg font-semibold tabular-nums">{stockDisplay}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Sold
                </p>
                <p className="text-lg font-semibold tabular-nums">{soldDisplay}</p>
              </div>
            </div>
            {linkedDayOverview ? <LinkedDayInventoryToolbar overview={linkedDayOverview} /> : null}
            <PackageCostLayers
              packageId={initial.id}
              packageName={initial.name}
              packageDuration={initial.duration}
              eventDate={initial.event_date}
              packageCurrency={(initial.currency || "USD").trim() || "USD"}
              salePrice={salePrice}
              layers={initial.cost_layers}
              salesBreakdown={salesBreakdown}
              linkedPackages={linkedPackages}
              linkedShellPackages={linkedShellPackages}
              sellable={sellable}
              stockTotal={stockDisplay}
              qtyAvailable={qtyAvailable}
              purchaseOrders={purchaseOrders}
              fulfilmentBlocks={fulfilmentBlocks}
              hasSalesforceProduct={!!initial.salesforce_product_id?.trim()}
              fulfilmentSoldByLayer={{
                ...(initial.fulfilment_sold_by_layer ?? {}),
                ...linkedPackages.reduce<Record<string, number>>((acc, p) => {
                  Object.assign(acc, p.fulfilment_sold_by_layer)
                  return acc
                }, {}),
              }}
              onInventoryChanged={onInventoryChanged}
            />
            <div className="border-t border-border pt-4">
              <FulfilmentBlocksPanel packageId={initial.id} blocks={fulfilmentBlocks} />
            </div>
          </>
        )}
      </div>
      ) : null}
    </div>
  )
}
