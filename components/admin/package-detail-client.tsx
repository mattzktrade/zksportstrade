"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { LinkedInventoryPackage, LinkedInventoryShellPackage } from "@/lib/admin/linked-inventory"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import type { LinkedDayPackageOverview } from "@/lib/admin/linked-day-package-overview"
import { adminCatalogProductTitleFromPackage } from "@/lib/admin/catalog-product-title"
import type { PackageDealSaleRow } from "@/lib/crm/deal-types"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"
import type { FulfilmentBlockWithUsage } from "@/lib/admin/fulfilment-blocks"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import { adminPackagePath, type AdminPackageTab } from "@/lib/admin/package-link"
import { fetchAdminPackageForCatalogExpand } from "@/app/(admin)/actions"
import { PackageAdminPanel } from "@/components/admin/package-admin-panel"
import { PackageOrdersTable } from "@/components/admin/package-orders-table"

const TABS: { id: AdminPackageTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "inventory", label: "Inventory & cost" },
  { id: "visibility", label: "Visibility" },
  { id: "orders", label: "Orders" },
]

function sellableQty(pkg: AdminPackageRow): number | null {
  if (!pkg.inventory) return null
  return Math.max(0, pkg.inventory.qty_available - pkg.inventory.qty_held)
}

export function PackageDetailClient({
  pkg,
  races,
  orders,
  deals = [],
  wixListings = [],
  linkedPackages = [],
  linkedShellPackages = [],
  linkedDayOverview,
  purchaseOrders = [],
  fulfilmentBlocks = [],
  initialTab = "details",
}: {
  pkg: AdminPackageRow
  races: AdminRaceOption[]
  orders: AdminOrderListRow[]
  deals?: PackageDealSaleRow[]
  wixListings?: WixChannelListingRow[]
  linkedPackages?: LinkedInventoryPackage[]
  linkedShellPackages?: LinkedInventoryShellPackage[]
  linkedDayOverview?: LinkedDayPackageOverview
  purchaseOrders?: PurchaseOrderRow[]
  fulfilmentBlocks?: FulfilmentBlockWithUsage[]
  initialTab?: AdminPackageTab
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<AdminPackageTab>(initialTab)
  const [livePkg, setLivePkg] = useState(pkg)
  const [liveLinkedPackages, setLiveLinkedPackages] = useState(linkedPackages)
  const [liveWixListings, setLiveWixListings] = useState(wixListings)

  useEffect(() => {
    setLivePkg(pkg)
  }, [pkg])

  useEffect(() => {
    setLiveLinkedPackages(linkedPackages)
  }, [linkedPackages])

  useEffect(() => {
    setLiveWixListings(wixListings)
  }, [wixListings])

  async function refreshInventory() {
    const full = await fetchAdminPackageForCatalogExpand(livePkg.id)
    if (full) {
      setLivePkg(full.pkg)
      setLiveLinkedPackages(full.linkedPackages)
      setLiveWixListings(full.wixListings)
    }
    router.refresh()
  }

  function setTab(tab: AdminPackageTab) {
    setActiveTab(tab)
    const path = adminPackagePath(livePkg.id, tab === "details" ? undefined : tab)
    window.history.replaceState(null, "", path)
  }

  const raceMatch = races.find((r) => r.id === livePkg.race_id)
  const displayTitle = adminCatalogProductTitleFromPackage(livePkg, raceMatch)
  const sellable = sellableQty(livePkg)
  const saleCount = orders.length + deals.length

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link href="/admin/catalog" className="text-sm text-primary hover:underline">
            ← Inventory
          </Link>
          <h1 className="text-2xl font-bold text-foreground leading-snug">{displayTitle}</h1>
          {livePkg.is_hidden ? (
            <p className="text-xs text-muted-foreground">Hidden from agent portal</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-sm shrink-0 text-right">
          <span className="text-muted-foreground">
            {saleCount} order{saleCount === 1 ? "" : "s"}
          </span>
          {sellable != null ? (
            <span className="text-xs font-medium text-foreground">{sellable} sellable</span>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-200">No inventory row</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.id === "orders" && saleCount > 0 ? (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">({saleCount})</span>
            ) : null}
            {t.id === "inventory" && sellable != null ? (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">({sellable})</span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "rounded-xl border border-border bg-card min-w-0 overflow-hidden",
          activeTab === "orders" ? "p-3 sm:p-4" : "p-4 sm:p-6",
        )}
      >
        {activeTab === "details" ? (
          <PackageAdminPanel
            initial={livePkg}
            races={races}
            wixListings={liveWixListings}
            section="details"
            onDeleted={() => router.push("/admin/catalog")}
          />
        ) : activeTab === "inventory" ? (
          <PackageAdminPanel
            initial={livePkg}
            races={races}
            wixListings={liveWixListings}
            linkedPackages={liveLinkedPackages}
            linkedShellPackages={linkedShellPackages}
            linkedDayOverview={linkedDayOverview}
            section="inventory"
            purchaseOrders={purchaseOrders}
            fulfilmentBlocks={fulfilmentBlocks}
            onInventoryChanged={refreshInventory}
          />
        ) : activeTab === "visibility" ? (
          <PackageAdminPanel
            initial={livePkg}
            races={races}
            wixListings={liveWixListings}
            linkedPackages={liveLinkedPackages}
            section="visibility"
          />
        ) : (
          <PackageOrdersTable
            orders={orders}
            deals={deals}
            purchaseOrders={purchaseOrders}
            costLayers={(() => {
              const duration = livePkg.duration?.trim() ?? ""
              const isLinkedDay =
                duration === "thursday_only" ||
                duration === "friday_only" ||
                duration === "saturday_only" ||
                duration === "sunday_only" ||
                duration === "2_day"
              if (isLinkedDay) {
                const parent = liveLinkedPackages.find(
                  (p) => p.duration === "3_day" && (p.cost_layers?.length ?? 0) > 0,
                )
                if (parent?.cost_layers?.length) return parent.cost_layers
              }
              return livePkg.cost_layers
            })()}
          />
        )}
      </div>
    </div>
  )
}
