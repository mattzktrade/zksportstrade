"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Download,
  FileText,
  ImageIcon,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  ShoppingCart,
  Trash2,
  ArrowUpDown,
} from "lucide-react"
import {
  createNativeDeal,
} from "@/app/(admin)/actions"
import {
  removeInventoryProduct,
  updateInventoryProductPublishing,
} from "@/app/(admin)/admin/catalog/inventory-actions"
import { saveSalesListCrmParty } from "@/app/(admin)/admin/inventory/sales-list/actions"
import type { AdminPackageRow } from "@/lib/admin/queries"
import type { CrmAccountOption } from "@/lib/crm/deal-types"
import { cn } from "@/lib/utils"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { EventFilter, uniqueEventFilterOptions } from "@/components/admin/event-filter"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import {
  createDealBasketLine,
  DealLineBasket,
  type DealBasketLine,
  type DealBasketSupplier,
} from "@/components/admin/deal-line-basket"
import { CatalogImage } from "@/components/catalog-image"
import { PackageGallery } from "@/components/package-gallery"
import { sanitizeHttpsUrl, sanitizeHttpsUrlList } from "@/lib/auth/safe-url"
import { adminPackagePath } from "@/lib/admin/package-link"

type Mode = "sales" | "manage"

function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isCurrentOrFutureEvent(row: AdminPackageRow, today = localDateKey()): boolean {
  return !row.event_date || row.event_date >= today
}

export type InventoryAvailabilityPresentation = {
  sellable: number
  activeReservations: number
  openShortageQty: number
  isLegacyShell: boolean
}

function money(value: number | null, currency: string): string {
  if (value == null) return "Price on request"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function liveQty(row: AdminPackageRow): number {
  return Number(row.inventory?.qty_available ?? 0)
}

function heldQty(row: AdminPackageRow): number {
  return Number(row.inventory?.qty_held ?? 0)
}

function soldQty(row: AdminPackageRow): number {
  const local = Number(row.sales_breakdown?.total ?? 0)
  const salesforce = Number(row.salesforce_inventory?.quantitySold ?? 0)
  return Math.max(0, Math.floor(Math.max(local, salesforce)))
}

function boughtQty(row: AdminPackageRow): number {
  const purchased = Number(row.layer_units_purchased ?? 0)
  if (purchased > 0) return purchased
  const salesforceStock = row.salesforce_inventory?.stock
  if (salesforceStock != null && Number.isFinite(salesforceStock) && salesforceStock > 0) {
    return Math.floor(salesforceStock)
  }
  return liveQty(row) + soldQty(row)
}

function downloadRows(rows: AdminPackageRow[], sharedGroupIds: Set<string>): void {
  const columns = [
    "Event",
    "Package",
    "Dates",
    "Location",
    "Stock type",
    "Live qty",
    "Held",
    "Bought",
    "Sold",
    "Price",
  ]
  const body = rows.map((row) => [
    row.race_name,
    row.name,
    row.date_range,
    row.location,
    row.inventory_group_id && sharedGroupIds.has(row.inventory_group_id) ? "Shared" : "Standalone",
    liveQty(row),
    heldQty(row),
    boughtQty(row),
    soldQty(row),
    row.trade_price ?? "",
  ])
  const csv = [columns, ...body]
    .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\r\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `zk-inventory-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function ProductThumb({ row, large = false }: { row: AdminPackageRow; large?: boolean }) {
  if (row.image) {
    return (
      <div
        role="img"
        aria-label={`${row.name} at ${row.race_name}`}
        className={cn("shrink-0 bg-cover bg-center", large ? "h-[200px] w-full rounded-lg" : "h-11 w-16 rounded-md")}
        style={{ backgroundImage: `url("${row.image.replaceAll('"', "%22")}")` }}
      />
    )
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-gradient-to-br from-slate-900 via-slate-700 to-primary text-white",
        large ? "h-[200px] w-full rounded-lg" : "h-11 w-16 rounded-md",
      )}
    >
      <Package className={large ? "h-8 w-8" : "h-4 w-4"} />
    </div>
  )
}

export function InventoryWorkspace({
  initialRows,
  mode,
  onAddProduct,
  onDataChanged,
  accountOptions = [],
  supplierOptions = [],
  nativeAvailability = {},
}: {
  initialRows: AdminPackageRow[]
  mode: Mode
  onAddProduct?: () => void
  onDataChanged?: () => void
  accountOptions?: CrmAccountOption[]
  supplierOptions?: DealBasketSupplier[]
  nativeAvailability?: Record<string, InventoryAvailabilityPresentation>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters(`zk-admin-inventory-${mode}-filters-v1`, {
    search: "",
    stockFilter: (mode === "sales" ? "available" : "all") as "all" | "available" | "low",
    eventTimingFilter: "future" as "future" | "all",
    eventFilter: [] as string[],
    yearFilter: "",
    stockTypeFilter: "",
    statusFilter: "",
    sortKey: "date" as "event" | "product" | "date" | "stock" | "price",
    sortDescending: false,
  })
  const {
    search,
    stockFilter,
    eventTimingFilter,
    eventFilter,
    yearFilter,
    stockTypeFilter,
    statusFilter,
    sortKey,
    sortDescending,
  } = listState
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRows.find((row) => !row.shell_parent_package_id && isCurrentOrFutureEvent(row))?.id ?? null,
  )
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [isHidden, setIsHidden] = useState(false)
  const [sellOnPortal, setSellOnPortal] = useState(true)
  const [sellOnWebsite, setSellOnWebsite] = useState(false)
  const [websitePrice, setWebsitePrice] = useState("")
  const [dealOpen, setDealOpen] = useState(false)
  const [dealMode, setDealMode] = useState<"deal" | "hold">("deal")
  const [dealAccountSearch, setDealAccountSearch] = useState("")
  const [dealAccountId, setDealAccountId] = useState("")
  const [dealCreatingCompany, setDealCreatingCompany] = useState(false)
  const [dealCompanyName, setDealCompanyName] = useState("")
  const [dealContactId, setDealContactId] = useState("")
  const [dealContactName, setDealContactName] = useState("")
  const [dealContactEmail, setDealContactEmail] = useState("")
  const [dealContactPhone, setDealContactPhone] = useState("")
  const [dealLines, setDealLines] = useState<DealBasketLine[]>([])
  const [dealReserve, setDealReserve] = useState(true)

  const catalogRows = useMemo(
    () => initialRows.filter((row) => !row.shell_parent_package_id),
    [initialRows],
  )
  const dealProducts = useMemo(
    () =>
      catalogRows
        .filter((row) => !row.is_hidden)
        .map((row) => ({
          id: row.id,
          eventName: row.race_name,
          packageName: row.name,
          label: `${row.race_name} — ${row.name}`,
          price: row.trade_price,
          currency: row.currency || "USD",
          stockLeft:
            nativeAvailability[row.id]?.sellable ??
            Math.max(0, Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0)),
        })),
    [catalogRows, nativeAvailability],
  )
  const sharedGroupIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of catalogRows) {
      const groupId = row.inventory_group_id?.trim()
      if (groupId) counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()]
        .filter(([, memberCount]) => memberCount > 1)
        .map(([groupId]) => groupId),
    )
  }, [catalogRows])
  const today = useMemo(() => localDateKey(), [])
  const eventScopeRows = useMemo(
    () =>
      eventTimingFilter === "future"
        ? catalogRows.filter((row) => isCurrentOrFutureEvent(row, today))
        : catalogRows,
    [catalogRows, eventTimingFilter, today],
  )
  const eventOptions = useMemo(
    () =>
      uniqueEventFilterOptions(
        eventScopeRows.map((row) => ({
          id: row.race_id,
          label: row.race_name,
          eventDate: row.event_date ?? null,
        })),
      ),
    [eventScopeRows],
  )
  const yearOptions = useMemo(
    () =>
      [...new Set(eventScopeRows.map((row) => row.event_date?.slice(0, 4)).filter(Boolean))]
        .sort()
        .reverse() as string[],
    [eventScopeRows],
  )
  const selectedDealAccount =
    accountOptions.find((account) => account.id === dealAccountId) ?? null
  const dealAccountResults = useMemo(() => {
    const query = dealAccountSearch.trim().toLowerCase()
    if (!query || dealAccountId) return []
    return accountOptions
      .filter((account) =>
        [account.name, ...account.contacts.flatMap((contact) => [contact.full_name, contact.email, contact.phone])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
      )
      .slice(0, 8)
  }, [accountOptions, dealAccountId, dealAccountSearch])
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = catalogRows.filter((row) => {
      const available = nativeAvailability[row.id]?.sellable ??
        Math.max(0, Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0))
      if (stockFilter === "available" && available <= 0) return false
      if (stockFilter === "low" && (available <= 0 || available > 10)) return false
      if (eventTimingFilter === "future" && !isCurrentOrFutureEvent(row, today)) return false
      if (eventFilter.length > 0 && !eventFilter.includes(row.race_id)) return false
      if (yearFilter && row.event_date?.slice(0, 4) !== yearFilter) return false
      if (stockTypeFilter === "in_stock" && liveQty(row) <= 0) return false
      if (stockTypeFilter === "out_of_stock" && liveQty(row) > 0) return false
      if (statusFilter === "active" && row.is_hidden) return false
      if (statusFilter === "archived" && !row.is_hidden) return false
      if (statusFilter === "portal" && (row.is_hidden || row.sell_on_trade_portal === false)) return false
      if (statusFilter === "website" && (row.is_hidden || !row.sell_on_wix)) return false
      if (
        statusFilter === "not_live" &&
        (row.is_hidden || row.sell_on_trade_portal !== false || row.sell_on_wix)
      ) return false
      if (!query) return true
      return [row.race_name, row.name, row.location, row.circuit, row.product_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
    return filtered.sort((a, b) => {
      const available = (row: AdminPackageRow) =>
        nativeAvailability[row.id]?.sellable ??
        Math.max(0, Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0))
      const comparison =
        sortKey === "product"
          ? a.name.localeCompare(b.name)
          : sortKey === "date"
            ? String(a.event_date).localeCompare(String(b.event_date))
            : sortKey === "stock"
              ? available(a) - available(b)
              : sortKey === "price"
                ? Number(a.trade_price ?? 0) - Number(b.trade_price ?? 0)
                : a.race_name.localeCompare(b.race_name) || a.name.localeCompare(b.name)
      return sortDescending ? -comparison : comparison
    })
  }, [
    catalogRows,
    eventFilter,
    eventTimingFilter,
    nativeAvailability,
    search,
    sortDescending,
    sortKey,
    statusFilter,
    stockFilter,
    stockTypeFilter,
    yearFilter,
    today,
  ])

  const selected = selectedId ? rows.find((row) => row.id === selectedId) ?? null : null
  const selectedImages = useMemo(() => {
    if (!selected) return []
    const raw = [
      selected.image,
      ...(Array.isArray(selected.gallery_images) ? selected.gallery_images : []),
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    return [...new Set(sanitizeHttpsUrlList(raw))]
  }, [selected])
  const selectedBrochure = sanitizeHttpsUrl(selected?.brochure_url)
  const selectedContents = useMemo(
    () =>
      Array.isArray(selected?.includes)
        ? selected.includes.filter(
            (item): item is string => typeof item === "string" && Boolean(item.trim()),
          )
        : [],
    [selected],
  )
  useEffect(() => {
    setGalleryIndex(0)
  }, [selectedId])
  useEffect(() => {
    setIsHidden(Boolean(selected?.is_hidden))
    setSellOnPortal(selected?.sell_on_trade_portal !== false)
    setSellOnWebsite(Boolean(selected?.sell_on_wix))
    setWebsitePrice(
      selected?.effective_website_price == null ? "" : String(selected.effective_website_price),
    )
  }, [
    selected?.id,
    selected?.is_hidden,
    selected?.sell_on_trade_portal,
    selected?.sell_on_wix,
    selected?.effective_website_price,
    selected?.wix_retail_price,
  ])
  const activeRows = eventScopeRows.filter((row) => !row.is_hidden)
  const lowStock = eventScopeRows.filter((row) => {
    const available = nativeAvailability[row.id]?.sellable ??
      Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0)
    return available > 0 && available <= 10
  }).length
  const totalAvailable = eventScopeRows.reduce(
    (sum, row) => sum + (
      nativeAvailability[row.id]?.sellable ??
      Math.max(0, Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0))
    ),
    0,
  )
  const featuredThisMonth = eventScopeRows.filter((row) => row.featured).length

  function savePublishing(next?: {
    isHidden?: boolean
    sellOnPortal?: boolean
    sellOnWebsite?: boolean
  }) {
    if (!selected) return
    const nextHidden = next?.isHidden ?? isHidden
    const nextPortal = next?.sellOnPortal ?? sellOnPortal
    const nextWebsite = next?.sellOnWebsite ?? sellOnWebsite
    const parsedPrice = websitePrice.trim() === "" ? null : Number(websitePrice)
    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      toast.error("Enter a valid website price.")
      return
    }
    if (nextWebsite && parsedPrice == null) {
      toast.error("Enter a website price before making this live on the website.")
      return
    }
    setIsHidden(nextHidden)
    setSellOnPortal(nextPortal)
    setSellOnWebsite(nextWebsite)
    startTransition(async () => {
      const result = await updateInventoryProductPublishing({
        packageId: selected.id,
        isHidden: nextHidden,
        sellOnPortal: nextPortal,
        sellOnWebsite: nextWebsite,
        websitePrice: parsedPrice,
      })
      if (!result.ok) {
        setIsHidden(Boolean(selected.is_hidden))
        setSellOnPortal(selected.sell_on_trade_portal !== false)
        setSellOnWebsite(Boolean(selected.sell_on_wix))
        setWebsitePrice(
          selected.effective_website_price == null ? "" : String(selected.effective_website_price),
        )
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onDataChanged?.()
      router.refresh()
    })
  }

  function submitDeal() {
    if (!selected) return
    if (!selectedDealAccount && !dealCreatingCompany) {
      toast.error("Select an existing company or create a new one.")
      return
    }
    if (!dealContactName.trim()) {
      toast.error("Select an existing contact or add a new contact name.")
      return
    }
    startTransition(async () => {
      const party = await saveSalesListCrmParty({
        accountId: selectedDealAccount?.id ?? null,
        accountName: dealCompanyName,
        contactId: dealContactId || null,
        contactName: dealContactName || null,
        contactEmail: dealContactEmail || null,
        contactPhone: dealContactPhone || null,
      })
      if (!party.ok) {
        toast.error(party.message)
        return
      }
      const result = await createNativeDeal({
        accountId: party.accountId,
        contactId: party.contactId,
        lines: dealLines.map((line) => ({
          packageId: line.packageId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          sourcingMode: line.sourcingMode,
          supplierId: line.supplierId || null,
          expectedUnitCost: line.expectedUnitCost,
          supplierQuoteAt: line.supplierQuoteAt || null,
        })),
        reserve: dealMode === "hold" ? true : dealReserve,
        source: "offline",
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setDealOpen(false)
      setDealMode("deal")
      setDealAccountSearch("")
      setDealAccountId("")
      setDealCreatingCompany(false)
      setDealCompanyName("")
      setDealContactId("")
      setDealContactName("")
      setDealContactEmail("")
      setDealContactPhone("")
      setDealLines([])
      if (dealMode === "deal") router.push("/admin/deals")
      router.refresh()
    })
  }

  function openDealComposer(mode: "deal" | "hold") {
    if (!selected) return
    const product = dealProducts.find((option) => option.id === selected.id)
    if (!product) return
    setDealMode(mode)
    setDealReserve(mode === "hold")
    setDealLines([createDealBasketLine(product)])
    setDealOpen(true)
  }

  function chooseDealAccount(account: CrmAccountOption) {
    setDealAccountId(account.id)
    setDealCreatingCompany(false)
    setDealAccountSearch("")
    setDealCompanyName(account.name)
    if (account.contacts.length === 1) {
      chooseDealContact(account.contacts[0])
    } else {
      setDealContactId("")
      setDealContactName("")
      setDealContactEmail("")
      setDealContactPhone("")
    }
  }

  function chooseDealContact(contact: CrmAccountOption["contacts"][number]) {
    setDealContactId(contact.id)
    setDealContactName(contact.full_name)
    setDealContactEmail(contact.email ?? "")
    setDealContactPhone(contact.phone ?? "")
  }

  function startNewDealCompany() {
    const name = dealAccountSearch.trim()
    if (!name) {
      toast.error("Enter the new company name.")
      return
    }
    setDealAccountId("")
    setDealCreatingCompany(true)
    setDealCompanyName(name)
    setDealAccountSearch("")
    setDealContactId("")
    setDealContactName("")
    setDealContactEmail("")
    setDealContactPhone("")
  }

  function removeSelectedProduct() {
    if (!selected) return
    if (
      !window.confirm(
        `Delete "${selected.name}"? If it has any business history it will be archived instead, so historical deals and orders remain safe.`,
      )
    ) return
    startTransition(async () => {
      const result = await removeInventoryProduct(selected.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setSelectedId(null)
      onDataChanged?.()
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <AdminPageHeader
        title="Inventory"
        description={
          mode === "sales"
            ? "Sales list — live sellable stock for the team"
            : "Manage inventory — create, edit and control products, pricing and stock levels"
        }
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          icon={Package}
          value={eventScopeRows.length.toLocaleString()}
          label="Total products"
          tone="blue"
        />
        <AdminStatCard
          icon={mode === "sales" ? Boxes : CheckCircle2}
          value={mode === "sales" ? totalAvailable.toLocaleString() : activeRows.length.toLocaleString()}
          label={mode === "sales" ? "Available quantity" : "Active products"}
          tone="green"
        />
        <AdminStatCard
          icon={mode === "sales" ? Sparkles : AlertTriangle}
          value={mode === "sales" ? featuredThisMonth : lowStock}
          label={mode === "sales" ? "Featured this month" : "Low stock items"}
          tone={mode === "sales" ? "purple" : "amber"}
        />
        <AdminStatCard
          icon={mode === "sales" ? AlertTriangle : FileText}
          value={mode === "sales" ? lowStock : eventScopeRows.filter((row) => row.is_hidden).length}
          label={mode === "sales" ? "Low stock alerts" : "Draft / unpublished"}
          tone={mode === "sales" ? "amber" : "purple"}
        />
      </AdminStats>

      <AdminPanel>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <div className="relative min-w-0 w-full flex-1 sm:min-w-[240px] sm:max-w-[370px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search event, product, circuit or package..."
              className="h-8 w-full rounded-md border border-[#e4e6ea] bg-white pl-9 pr-3 text-[10px] outline-none focus:border-primary/40"
            />
          </div>
          <select
            value={eventTimingFilter}
            onChange={(event) => {
              setListState((current) => ({
                ...current,
                eventTimingFilter: event.target.value as "future" | "all",
                eventFilter: [],
                yearFilter: "",
              }))
            }}
            className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] font-medium text-[#62666e]"
          >
            <option value="future">Future events</option>
            <option value="all">All events</option>
          </select>
          <EventFilter
            options={eventOptions}
            selectedIds={eventFilter}
            onChange={(eventFilter) => setListState((current) => ({ ...current, eventFilter }))}
            inputClassName="h-8 border-[#e4e6ea] text-[#62666e] focus:border-primary/40"
          />
          <select value={yearFilter} onChange={(event) => setListState((current) => ({ ...current, yearFilter: event.target.value }))} className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]">
            <option value="">All years</option>
            {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select value={stockTypeFilter} onChange={(event) => setListState((current) => ({ ...current, stockTypeFilter: event.target.value }))} className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]">
            <option value="">All stock</option>
            <option value="in_stock">In stock</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
          <select value={statusFilter} onChange={(event) => setListState((current) => ({ ...current, statusFilter: event.target.value }))} className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]">
            <option value="">All statuses</option>
            <option value="active">Not hidden</option>
            <option value="portal">Live on portal</option>
            <option value="website">Live on website</option>
            <option value="not_live">Not live</option>
            <option value="archived">Hidden</option>
          </select>
          <select value={sortKey} onChange={(event) => setListState((current) => ({ ...current, sortKey: event.target.value as typeof sortKey }))} className="h-8 rounded-md border border-[#e4e6ea] bg-white px-2 text-[9px] text-[#62666e]">
            <option value="event">Sort: Event</option>
            <option value="product">Sort: Product</option>
            <option value="date">Sort: Date</option>
            <option value="stock">Sort: Stock</option>
            <option value="price">Sort: Price</option>
          </select>
          <button type="button" onClick={() => setListState((current) => ({ ...current, sortDescending: !current.sortDescending }))} title={sortDescending ? "Descending" : "Ascending"} className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e4e6ea] text-[#62666e]">
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => downloadRows(rows, sharedGroupIds)}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-[#e4e6ea] px-3 text-[9px] text-[#62666e]"
          >
            <Download className="h-3.5 w-3.5" />
            Export list
          </button>
          {mode === "manage" ? (
            <button
              type="button"
              onClick={onAddProduct}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[9px] font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add product
            </button>
          ) : null}
        </div>

        {mode === "sales" ? (
          <div className="flex flex-wrap gap-1.5 border-b border-[#eceef1] px-3 py-2">
            {[
              ["all", "All stock"],
              ["available", "Available"],
              ["low", "Low stock"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setListState((current) => ({ ...current, stockFilter: value as "all" | "available" | "low" }))}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[9px] font-medium",
                  stockFilter === value
                    ? "border-primary bg-red-50 text-primary"
                    : "border-[#e5e7eb] text-[#6c7078]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className={cn(
          "grid md:min-h-[600px]",
          selected && "xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]",
        )}>
          <div className={cn("min-w-0", selected && "xl:border-r xl:border-[#eceef1]")}>
            <AdminDesktopTable>
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Package</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Stock type</th>
                  {mode === "manage" ? <th className="px-3 py-2 font-medium">Status</th> : null}
                  <th className="px-3 py-2 font-medium">{mode === "manage" ? "Live qty" : "Qty"}</th>
                  {mode === "manage" ? <th className="px-3 py-2 font-medium">Held</th> : null}
                  {mode === "manage" ? <th className="px-3 py-2 font-medium">Bought</th> : null}
                  {mode === "manage" ? <th className="px-3 py-2 font-medium">Sold</th> : null}
                  <th className="px-3 py-2 font-medium">Sell price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                {rows.map((row) => {
                  const available = nativeAvailability[row.id]?.sellable ?? Math.max(
                    0,
                    Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0),
                  )
                  const availability = nativeAvailability[row.id]
                  const selectedRow = selected?.id === row.id
                  return (
                    <tr
                      key={row.id}
                      onClick={() => {
                        setSelectedId(row.id)
                      }}
                      className={cn("cursor-pointer hover:bg-slate-50", selectedRow && "bg-red-50/60")}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-[#3b3e44]">{row.race_name}</div>
                        <div className="mt-0.5 text-[8px] text-[#a0a3a9]">{row.country || row.location}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <ProductThumb row={row} />
                          <Link
                            href={adminPackagePath(row.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="max-w-[150px] font-medium text-primary hover:underline"
                          >
                            {row.name}
                          </Link>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#6a6e76]">{row.date_range || "—"}</td>
                      <td className="px-3 py-2.5 text-[#6a6e76]">{row.location || row.circuit}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <StatusPill tone={row.inventory_group_id && sharedGroupIds.has(row.inventory_group_id) ? "purple" : "green"}>
                            {row.inventory_group_id && sharedGroupIds.has(row.inventory_group_id) ? "Shared" : "Standalone"}
                          </StatusPill>
                          {mode === "sales" && availability ? <StatusPill tone="blue">Native</StatusPill> : null}
                          {availability?.openShortageQty ? (
                            <StatusPill tone="amber">{availability.openShortageQty} sourcing</StatusPill>
                          ) : null}
                        </div>
                      </td>
                      {mode === "manage" ? (
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {row.is_hidden ? <StatusPill tone="gray">Hidden</StatusPill> : null}
                            {!row.is_hidden && row.sell_on_trade_portal !== false ? <StatusPill tone="green">Portal</StatusPill> : null}
                            {!row.is_hidden && row.sell_on_wix ? <StatusPill tone="blue">Website</StatusPill> : null}
                            {!row.is_hidden && row.sell_on_trade_portal === false && !row.sell_on_wix ? <StatusPill tone="gray">Not live</StatusPill> : null}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 font-semibold text-[#393c42]">
                        {mode === "manage" ? liveQty(row) : available}
                      </td>
                      {mode === "manage" ? (
                        <td className="px-3 py-2.5 text-[#6a6e76]">{heldQty(row)}</td>
                      ) : null}
                      {mode === "manage" ? (
                        <td className="px-3 py-2.5 text-[#6a6e76]">{boughtQty(row)}</td>
                      ) : null}
                      {mode === "manage" ? (
                        <td className="px-3 py-2.5 text-[#6a6e76]">{soldQty(row)}</td>
                      ) : null}
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-[#393c42]">
                        {money(row.trade_price, row.currency)}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={mode === "manage" ? 11 : 7} className="px-4 py-12 text-center text-[10px] text-slate-400">
                      No inventory matches these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {rows.map((row) => {
                const available = nativeAvailability[row.id]?.sellable ?? Math.max(
                  0,
                  Number(row.inventory?.qty_available ?? 0) - Number(row.inventory?.qty_held ?? 0),
                )
                return (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 px-4 py-3 text-left",
                      selected?.id === row.id && "bg-red-50/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-primary">{row.name}</p>
                      <p className="mt-0.5 font-medium text-slate-700">{row.race_name}</p>
                      <p className="mt-0.5 text-[8px] text-slate-400">{row.date_range || row.location || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold">{money(row.trade_price, row.currency)}</p>
                      <p className="mt-0.5 text-[8px] text-slate-500">
                        {mode === "manage" ? `${liveQty(row)} live` : `${available} avail.`}
                      </p>
                    </div>
                  </button>
                )
              })}
              {rows.length === 0 ? (
                <p className="px-4 py-12 text-center text-[10px] text-slate-400">No inventory matches these filters.</p>
              ) : null}
            </AdminMobileList>
          </div>

          {selected ? (
            <aside className="bg-white p-4 sm:p-5 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-14 max-md:z-40 max-md:overflow-y-auto">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[12px] font-semibold text-[#292b30]">{selected.name} — {selected.race_name}</h2>
                    <p className="mt-0.5 text-[9px] text-[#8b8f97]">{selected.product_code || selected.id}</p>
                  </div>
                  <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl text-slate-400 md:h-auto md:w-auto md:text-base" onClick={() => setSelectedId(null)}>×</button>
                </div>
                <div className="space-y-2">
                  <PackageGallery
                    images={selectedImages}
                    alt={`${selected.name} at ${selected.race_name}`}
                    selectedIndex={Math.min(galleryIndex, Math.max(0, selectedImages.length - 1))}
                    onSelectIndex={setGalleryIndex}
                    warmCache
                    className="aspect-[16/10]"
                  />
                  {selectedImages.length > 1 ? (
                    <div className="grid grid-cols-5 gap-1.5">
                      {selectedImages.map((image, index) => (
                        <button
                          key={image}
                          type="button"
                          onClick={() => setGalleryIndex(index)}
                          className={cn(
                            "relative aspect-[4/3] overflow-hidden rounded-md border-2",
                            galleryIndex === index ? "border-primary" : "border-transparent",
                          )}
                          aria-label={`View photo ${index + 1}`}
                        >
                          <CatalogImage src={image} alt="" variant="thumb" fill className="object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    {selectedImages[galleryIndex] ? (
                      <a
                        href={selectedImages[galleryIndex]}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[8px] font-semibold text-slate-600"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        Open photo
                      </a>
                    ) : null}
                    {selectedBrochure ? (
                      <a
                        href={selectedBrochure}
                        target="_blank"
                        rel="noreferrer"
                        download={`${selected.name.replaceAll(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "package"}-brochure.pdf`}
                        className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-900 text-[8px] font-semibold text-white"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Download brochure
                        <Download className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-[9px]">
                  <dt className="text-[#93979f]">Dates</dt><dd className="font-medium">{selected.date_range || "—"}</dd>
                  <dt className="text-[#93979f]">Location</dt><dd className="font-medium">{selected.location || selected.circuit}</dd>
                  <dt className="text-[#93979f]">Stock type</dt>
                  <dd>
                    <StatusPill tone={selected.inventory_group_id && sharedGroupIds.has(selected.inventory_group_id) ? "purple" : "green"}>
                      {selected.inventory_group_id && sharedGroupIds.has(selected.inventory_group_id) ? "Shared across products" : "Standalone"}
                    </StatusPill>
                  </dd>
                  {mode === "manage" ? (
                    <>
                      <dt className="text-[#93979f]">Live qty</dt>
                      <dd className="font-semibold">{liveQty(selected)}</dd>
                      <dt className="text-[#93979f]">Held</dt>
                      <dd className="font-semibold">{heldQty(selected)}</dd>
                      <dt className="text-[#93979f]">Total bought</dt>
                      <dd className="font-semibold">{boughtQty(selected)}</dd>
                      <dt className="text-[#93979f]">Total sold</dt>
                      <dd className="font-semibold">{soldQty(selected)}</dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-[#93979f]">Quantity available</dt>
                      <dd className="font-semibold">
                        {nativeAvailability[selected.id]?.sellable ??
                          Math.max(0, liveQty(selected) - heldQty(selected))}
                      </dd>
                    </>
                  )}
                  <dt className="text-[#93979f]">Price from</dt><dd className="font-semibold">{money(selected.trade_price, selected.currency)} per person</dd>
                </dl>
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="text-[9px] font-semibold text-slate-800">Package contents</h3>
                  {selectedContents.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {selectedContents.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-[8px] leading-4 text-slate-600">
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[8px] text-slate-400">No package contents have been added yet.</p>
                  )}
                </div>
                {selected.description?.trim() ? (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <h3 className="text-[9px] font-semibold text-slate-800">Package overview</h3>
                    <p className="mt-1.5 whitespace-pre-line text-[8px] leading-4 text-slate-600">
                      {selected.description}
                    </p>
                  </div>
                ) : null}

                {mode === "manage" ? (
                  <div className="space-y-2 rounded-lg border border-[#e5e7eb] bg-[#fafbfc] p-3">
                    <div>
                      <h3 className="text-[9px] font-semibold text-[#555961]">Product visibility</h3>
                      <p className="mt-0.5 text-[8px] text-[#93979f]">Hidden overrides both live channels without losing their settings.</p>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-white px-2.5 py-2 text-[9px]">
                      <span className="font-medium text-[#555961]">Live on agent portal</span>
                      <input type="checkbox" checked={sellOnPortal} disabled={pending} onChange={(event) => savePublishing({ sellOnPortal: event.target.checked })} className="h-4 w-4 accent-primary" />
                    </label>
                    <div className="rounded-md bg-white px-2.5 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-[9px] font-medium text-[#555961]">
                          <input type="checkbox" checked={sellOnWebsite} disabled={pending} onChange={(event) => savePublishing({ sellOnWebsite: event.target.checked })} className="h-4 w-4 accent-primary" />
                          Live on website
                        </label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[8px] text-[#93979f]">{selected.currency || "USD"}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={websitePrice}
                            onChange={(event) => setWebsitePrice(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") savePublishing()
                            }}
                            placeholder="Website price"
                            className="h-7 w-24 rounded-md border border-[#e4e6ea] px-2 text-right text-[9px] outline-none focus:border-primary/50"
                          />
                          <button type="button" disabled={pending} onClick={() => savePublishing()} className="h-7 rounded-md border border-primary px-2 text-[8px] font-medium text-primary disabled:opacity-50">
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-white px-2.5 py-2 text-[9px]">
                      <span>
                        <span className="block font-medium text-[#555961]">Hidden</span>
                        <span className="text-[8px] text-[#93979f]">Keep this product off the portal and website</span>
                      </span>
                      <input type="checkbox" checked={isHidden} disabled={pending} onChange={(event) => savePublishing({ isHidden: event.target.checked })} className="h-4 w-4 accent-primary" />
                    </label>
                  </div>
                ) : null}

                <div className="border-t border-[#eceef1] pt-3">
                  <h3 className="mb-2 text-[9px] font-semibold text-[#555961]">Stock overview</h3>
                  <div className={cn("grid gap-2", mode === "manage" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
                    {(mode === "manage"
                      ? [
                          ["Live qty", liveQty(selected)],
                          ["Held", heldQty(selected)],
                          ["Bought", boughtQty(selected)],
                          ["Sold", soldQty(selected)],
                        ]
                      : [
                          [
                            "Available",
                            nativeAvailability[selected.id]?.sellable ??
                              Math.max(0, liveQty(selected) - heldQty(selected)),
                          ],
                          [
                            "Reserved",
                            nativeAvailability[selected.id]?.activeReservations ?? heldQty(selected),
                          ],
                          ["Live", liveQty(selected)],
                        ]
                    ).map(([label, value]) => (
                      <div key={String(label)} className="rounded-md bg-[#fafbfc] p-2 text-center">
                        <p className="text-[12px] font-semibold">{value}</p>
                        <p className="mt-0.5 text-[8px] text-[#93979f]">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {mode === "sales" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openDealComposer("deal")}
                        className="flex h-9 items-center justify-center rounded-md bg-primary text-[9px] font-semibold text-white"
                      >
                        Create deal
                      </button>
                      <button
                        type="button"
                        onClick={() => openDealComposer("hold")}
                        className="flex h-9 items-center justify-center rounded-md border border-primary text-[9px] font-semibold text-primary"
                      >
                        Place hold
                      </button>
                    </div>
                    {dealOpen ? (
                      <div className="space-y-2 rounded-lg border border-[#e5e7eb] bg-[#fafbfc] p-3">
                        <h3 className="text-[9px] font-semibold text-[#42464d]">
                          {dealMode === "hold" ? "Place a 7-day stock hold" : "Create offline deal"}
                        </h3>
                        {!selectedDealAccount && !dealCreatingCompany ? (
                          <div className="relative">
                            <input
                              value={dealAccountSearch}
                              onChange={(event) => setDealAccountSearch(event.target.value)}
                              placeholder="Search CRM accounts, contacts or emails…"
                              className="h-9 w-full rounded-md border bg-white px-2 text-[9px]"
                            />
                            {dealAccountSearch.trim() ? (
                              <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-white p-1 shadow-lg">
                                {dealAccountResults.map((account) => (
                                  <button key={account.id} type="button" onClick={() => chooseDealAccount(account)} className="block w-full rounded px-2 py-2 text-left hover:bg-slate-50">
                                    <span className="block text-[9px] font-medium">{account.name}</span>
                                    <span className="text-[8px] text-slate-400">{account.contacts.length} contact{account.contacts.length === 1 ? "" : "s"}</span>
                                  </button>
                                ))}
                                <button type="button" onClick={startNewDealCompany} className="block w-full rounded border-t px-2 py-2 text-left text-[9px] font-medium text-primary hover:bg-red-50">
                                  + Create “{dealAccountSearch.trim()}” as a new company
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[8px] font-medium text-emerald-700">
                                {dealCreatingCompany ? "New CRM company" : "Existing CRM company"}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setDealAccountId("")
                                  setDealCreatingCompany(false)
                                  setDealCompanyName("")
                                  setDealContactId("")
                                  setDealContactName("")
                                  setDealContactEmail("")
                                  setDealContactPhone("")
                                }}
                                className="text-[8px] font-medium text-primary"
                              >
                                Change company
                              </button>
                            </div>
                            <input value={dealCompanyName} onChange={(event) => setDealCompanyName(event.target.value)} placeholder="Company name" className="h-9 w-full rounded-md border bg-white px-2 text-[9px]" />
                            {selectedDealAccount && selectedDealAccount.contacts.length > 1 ? (
                              <select
                                value={dealContactId}
                                onChange={(event) => {
                                  const contact = selectedDealAccount.contacts.find((item) => item.id === event.target.value)
                                  if (contact) chooseDealContact(contact)
                                  else {
                                    setDealContactId("")
                                    setDealContactName("")
                                    setDealContactEmail("")
                                    setDealContactPhone("")
                                  }
                                }}
                                className="h-9 w-full rounded-md border bg-white px-2 text-[9px]"
                              >
                                <option value="">Add a new contact…</option>
                                {selectedDealAccount.contacts.map((contact) => (
                                  <option key={contact.id} value={contact.id}>{contact.full_name}{contact.email ? ` · ${contact.email}` : ""}</option>
                                ))}
                              </select>
                            ) : null}
                            {selectedDealAccount && dealContactId ? (
                              <button type="button" onClick={() => {
                                setDealContactId("")
                                setDealContactName("")
                                setDealContactEmail("")
                                setDealContactPhone("")
                              }} className="text-left text-[8px] font-medium text-primary">
                                + Add a different contact to this company
                              </button>
                            ) : null}
                            <input value={dealContactName} onChange={(event) => setDealContactName(event.target.value)} placeholder="Contact name" className="h-9 w-full rounded-md border bg-white px-2 text-[9px]" />
                            <div className="grid grid-cols-2 gap-2">
                              <input type="email" value={dealContactEmail} onChange={(event) => setDealContactEmail(event.target.value)} placeholder="Contact email" className="h-9 rounded-md border bg-white px-2 text-[9px]" />
                              <input value={dealContactPhone} onChange={(event) => setDealContactPhone(event.target.value)} placeholder="Contact phone" className="h-9 rounded-md border bg-white px-2 text-[9px]" />
                            </div>
                          </>
                        )}
                        <DealLineBasket
                          products={dealProducts}
                          suppliers={supplierOptions}
                          lines={dealLines}
                          onChange={setDealLines}
                          compact
                        />
                        <div className="grid grid-cols-1 gap-2">
                          {dealMode === "hold" ? (
                            <div className="flex items-center rounded-md bg-amber-50 px-2 text-[8px] font-medium text-amber-700">Automatically releases after 7 days</div>
                          ) : (
                            <label className="flex items-center gap-2 text-[8px] font-medium">
                              <input type="checkbox" checked={dealReserve} onChange={(e) => setDealReserve(e.target.checked)} />
                              Reserve stock for 7 days
                            </label>
                          )}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setDealOpen(false)} className="h-8 rounded-md border bg-white px-3 text-[8px]">Cancel</button>
                          <button type="button" disabled={pending} onClick={submitDeal} className="h-8 rounded-md bg-primary px-3 text-[8px] font-semibold text-white disabled:opacity-50">
                            {pending ? "Saving…" : dealMode === "hold" ? "Place hold" : "Create deal"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Link href={`/admin/catalog/${selected.id}`} className="flex h-9 items-center justify-center gap-1 rounded-md bg-primary text-[8px] font-semibold text-white">
                        <Pencil className="h-3 w-3" /> Edit product
                      </Link>
                      <Link href={`/admin/catalog/${selected.id}?tab=inventory`} className="flex h-9 items-center justify-center gap-1 rounded-md border border-primary text-[8px] font-semibold text-primary">
                        <ShoppingCart className="h-3 w-3" /> Add stock
                      </Link>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={removeSelectedProduct}
                        className="flex h-9 items-center justify-center gap-1 rounded-md border border-red-200 text-[8px] font-medium text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Delete product
                      </button>
                    </div>
                  </>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </AdminPanel>
    </div>
  )
}
