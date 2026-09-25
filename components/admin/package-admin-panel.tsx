"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  deletePackage,
  insertPackageInventory,
  placeStaffStockHold,
  releaseInventoryHold,
  updatePackageFields,
} from "@/app/(admin)/actions"
import type { LinkedInventoryPackage, LinkedInventoryShellPackage } from "@/lib/admin/linked-inventory"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import type { LinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { adminRaceLabel } from "@/lib/admin/race-label"
import { cn } from "@/lib/utils"
import { PackageCostLayers } from "@/components/admin/package-cost-layers"
import { PackageIntegrationPanel } from "@/components/admin/package-integration-panel"
import { PackageBrochureActions } from "@/components/admin/package-brochure-actions"
import { PackageGuestGuidePanel } from "@/components/admin/package-guest-guide-panel"
import { CatalogImageField } from "@/components/admin/catalog-image-field"
import { PackageCopyFields } from "@/components/admin/package-copy-fields"
import { PackageFaqFields } from "@/components/admin/package-faq-fields"
import { mergePackageFaqs, parsePackageFaqs, suggestedPackageFaqs, type PackageFaqSource } from "@/lib/catalog/package-faqs"
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
import { packageEventDefaultsFromRace } from "@/lib/catalog/race-circuit"

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

function DetailSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="sm:col-span-2 overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{summary}</span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2">{children}</div> : null}
    </section>
  )
}

function imageSummary(image: string, gallery: string, trackMap: string): string {
  const count = (image.trim() ? 1 : 0) + linesToList(gallery).length + (trackMap.trim() ? 1 : 0)
  if (count === 0) return "No images yet"
  return `${count} image${count === 1 ? "" : "s"}${trackMap.trim() ? ", including a track map" : ""}`
}

function faqSummary(faqs: { answer: string }[]): string {
  const answered = faqs.filter((faq) => faq.answer.trim()).length
  const blank = faqs.length - answered
  if (faqs.length === 0) return "No questions yet"
  if (blank === 0) return `${answered} answered`
  return `${answered} answered · ${blank} still to complete`
}

function currencyHint(currency: string): string {
  const c = (currency || "USD").trim() || "USD"
  return `Amounts in ${c}`
}

function packageFaqsFromRow(row: AdminPackageRow) {
  return mergePackageFaqs(
    parsePackageFaqs(row.faqs),
    suggestedPackageFaqs({
      name: row.name,
      raceName: row.race_name,
      circuit: row.circuit,
      location: row.location,
      country: row.country,
      eventDate: String(row.event_date ?? ""),
      dateRange: row.date_range,
      duration: row.duration,
      description: typeof row.description === "string" ? row.description : "",
      includes: Array.isArray(row.includes) ? row.includes.filter((item): item is string => typeof item === "string") : [],
      currency: row.currency || "USD",
      tradePrice: row.trade_price,
      isEnquiry: row.is_enquiry,
      brochureUrl: row.brochure_url,
    }),
  )
}

function faqSource(input: {
  name: string
  raceName: string
  circuit: string
  location: string
  country: string
  eventDate: string
  dateRange: string
  duration: string
  description: string
  includesText: string
  currency: string
  tradePrice: string
  isEnquiry: boolean
  brochureUrl: string
}): PackageFaqSource {
  const price = input.tradePrice.trim() === "" ? null : Number(input.tradePrice)
  return {
    name: input.name,
    raceName: input.raceName,
    circuit: input.circuit,
    location: input.location,
    country: input.country,
    eventDate: input.eventDate,
    dateRange: input.dateRange,
    duration: input.duration,
    description: input.description,
    includes: linesToList(input.includesText),
    currency: input.currency || "USD",
    tradePrice: price != null && Number.isFinite(price) ? price : null,
    isEnquiry: input.isEnquiry,
    brochureUrl: input.brochureUrl,
  }
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
  const [guestGuideUrl, setGuestGuideUrl] = useState(
    typeof initial.guest_guide_url === "string" ? initial.guest_guide_url : "",
  )
  const [trackMap, setTrackMap] = useState(typeof initial.track_map === "string" ? initial.track_map : "")
  const [faqs, setFaqs] = useState(() => packageFaqsFromRow(initial))
  const [holdQty, setHoldQty] = useState("1")
  const [holdNote, setHoldNote] = useState("")
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
    setGuestGuideUrl(typeof initial.guest_guide_url === "string" ? initial.guest_guide_url : "")
    setTrackMap(typeof initial.track_map === "string" ? initial.track_map : "")
    setFaqs(packageFaqsFromRow(initial))
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
        total_capacity: Math.max(0, Math.floor(Number(initial.total_capacity) || 0)),
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
        track_map: trackMap.trim() || null,
        faqs,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Package updated.")
      router.refresh()
    })
  }


  function placeHold() {
    const quantity = Math.floor(Number(holdQty))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Enter a whole number of units to hold.")
      return
    }
    start(async () => {
      const res = await placeStaffStockHold({
        packageId: initial.id,
        quantity,
        note: holdNote.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(
        quantity === 1 ? "1 unit is on hold." : `${quantity} units are on hold.`,
      )
      setHoldNote("")
      router.refresh()
      onInventoryChanged?.()
    })
  }

  function releaseHold(holdId: string) {
    start(async () => {
      const res = await releaseInventoryHold(holdId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Hold released.")
      router.refresh()
      onInventoryChanged?.()
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
  const reservedQty = Math.max(0, Math.floor(Number(initial.canonical_availability?.reserved) || 0))
  const manualHoldQty = Math.max(0, Math.floor(Number(initial.canonical_availability?.manualHold) || 0))
  const qtyHeldNum = initial.canonical_availability
    ? reservedQty + manualHoldQty
    : Math.max(0, Math.floor(Number(initial.inventory?.qty_held) || 0))
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground sm:col-span-2">
            {isFormula1Event ? "Race" : "Event"}
            <select
              value={raceId}
              onChange={(e) => {
                const next = e.target.value
                setRaceId(next)
                const race = races.find((r) => r.id === next)
                if (!race) return
                const defaults = packageEventDefaultsFromRace(race)
                setCircuit(defaults.circuit)
                setLocation(defaults.location)
                setCountry(defaults.country)
                setCountryCode(defaults.countryCode)
                setEventDate(defaults.eventDate)
                setDateRange(defaults.dateRange)
              }}
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
          </label>
          <label className="block text-xs text-muted-foreground">
            Trade price (blank if enquiry)
            <input
              value={tradePrice}
              onChange={(e) => setTradePrice(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <span className="block text-[11px] text-muted-foreground/80 mt-1">
              {currencyHint((initial.currency || "USD").trim() || "USD")}
            </span>
          </label>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresBookingApproval}
                onChange={(e) => setRequiresBookingApproval(e.target.checked)}
              />
              Requires booking approval
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              Featured
            </label>
          </div>
          <DetailSection
            title="Event"
            summary={[circuit.trim(), dateRange.trim() || eventDate.trim()].filter(Boolean).join(" · ") || "Venue and dates"}
          >
            <label className="block text-xs text-muted-foreground sm:col-span-2">
              {isFormula1Event ? "Circuit" : "Venue"}
              <input
                value={circuit}
                onChange={(e) => setCircuit(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/90">
                Shared with the event. Edit it on Inventory → Events to update every product for this race.
              </span>
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
            <label className="block text-xs text-muted-foreground sm:max-w-xs">
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
          </DetailSection>
          <DetailSection
            title="Images"
            summary={imageSummary(image, galleryText, trackMap)}
          >
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
            <div className="sm:col-span-2 space-y-1">
              <CatalogImageField label="Track map" value={trackMap} onChange={setTrackMap} />
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                Optional circuit layout. Shown on the product page, and added as brochure page 3 when you create a
                brochure.
              </p>
            </div>
          </DetailSection>
          <DetailSection
            title="Description and inclusions"
            summary={description.trim() ? description.trim().replace(/\s+/g, " ").slice(0, 90) : "No description yet"}
          >
            <PackageCopyFields
              description={description}
              includesText={includesText}
              onDescriptionChange={setDescription}
              onIncludesChange={setIncludesText}
            />
          </DetailSection>
          <DetailSection
            title="FAQs"
            summary={faqSummary(faqs)}
          >
            <PackageFaqFields
              faqs={faqs}
              onChange={setFaqs}
              source={faqSource({
                name,
                raceName: initial.race_name,
                circuit,
                location,
                country,
                eventDate,
                dateRange,
                duration,
                description,
                includesText,
                currency: initial.currency,
                tradePrice,
                isEnquiry,
                brochureUrl,
              })}
            />
          </DetailSection>
          <DetailSection
            title="Stock sharing"
            summary={inventoryIsStandalone ? "Separate inventory" : inventoryGroupId.trim() || "Shares stock with linked packages"}
          >
            <label className="block text-xs text-muted-foreground sm:col-span-2">
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
          </DetailSection>
          <DetailSection
            title="Brochures"
            summary={[brochureUrl.trim() ? "Sales brochure attached" : "No sales brochure", guestGuideUrl.trim() ? "Guest guide attached" : "No guest guide"].join(" · ")}
          >
          <div className="sm:col-span-2 space-y-3">
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Sales brochure</p>
                <p className="mt-1 text-xs text-muted-foreground leading-5">
                  Creates a ZK-branded PDF from this product&apos;s photos, description and inclusions.
                  Needs at least 3 unique photos, a short description, and 4 inclusions. Standard Paddock
                  Club or Champions Club copy can be filled from official programme details when the name
                  matches. Only the ZK team can generate it — portal clients just download the finished file.
                </p>
              </div>
              <PackageBrochureActions
                packageId={initial.id}
                brochureUrl={brochureUrl.trim() || null}
                productName={name.trim() || initial.name}
                eventName={initial.race_name}
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
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <PackageGuestGuidePanel
              packageId={initial.id}
              productName={name.trim() || initial.name}
              eventName={initial.race_name}
              location={location.trim() || initial.location}
              guestGuideUrl={guestGuideUrl.trim() || null}
              storedGuide={initial.guest_guide}
              onUrlChange={(url) => setGuestGuideUrl(url)}
            />
          </div>
          </div>
          </DetailSection>
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
            <div className="flex flex-wrap items-center gap-2 max-w-3xl">
              {(initial.staff_holds ?? []).map((hold) => (
                <div
                  key={hold.id}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 pl-3 pr-1.5 py-1 text-sm"
                >
                  <span className="tabular-nums font-medium">{hold.quantity}</span>
                  <span className="text-muted-foreground">
                    {hold.note?.trim() || "held until released"}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => releaseHold(hold.id)}
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                  >
                    Release
                  </button>
                </div>
              ))}
              <form
                className="inline-flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  placeHold()
                }}
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={holdQty}
                  onChange={(event) => setHoldQty(event.target.value)}
                  aria-label="Units to hold"
                  title="Stays off sale until you release it"
                  className="h-8 w-14 rounded-full border border-border bg-background px-2.5 text-sm tabular-nums"
                />
                <input
                  value={holdNote}
                  onChange={(event) => setHoldNote(event.target.value)}
                  placeholder="Note"
                  aria-label="Hold note"
                  className="h-8 w-36 rounded-full border border-border bg-background px-3 text-sm"
                />
                <button
                  type="submit"
                  disabled={pending || sellable < 1}
                  className="h-8 px-3 rounded-full border border-border bg-background text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Hold
                </button>
              </form>
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
