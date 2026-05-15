"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { adminPackagePath, parseAdminPackageTab, type AdminPackageTab } from "@/lib/admin/package-link"
import { PackageAdminPanel } from "@/components/admin/package-admin-panel"
import { PackageOrdersTable } from "@/components/admin/package-orders-table"

const TABS: { id: AdminPackageTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "inventory", label: "Inventory & cost" },
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
}: {
  pkg: AdminPackageRow
  races: AdminRaceOption[]
  orders: AdminOrderListRow[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = parseAdminPackageTab(searchParams.get("tab"))

  function setTab(tab: AdminPackageTab) {
    router.replace(adminPackagePath(pkg.id, tab === "details" ? undefined : tab), { scroll: false })
  }

  const raceLabel = races.find((r) => r.id === pkg.race_id)?.name ?? pkg.race_name
  const durationLabel = packageDurationLabel(pkg.duration)
  const sellable = sellableQty(pkg)

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Link href="/admin/catalog" className="text-sm text-primary hover:underline">
            ← Catalog
          </Link>
          <h1 className="text-2xl font-bold text-foreground truncate">{pkg.name}</h1>
          <p className="text-sm text-muted-foreground">
            {raceLabel}
            {pkg.circuit ? ` · ${pkg.circuit}` : ""}
            {durationLabel ? ` · ${durationLabel}` : ""}
          </p>
          <p className="text-xs font-mono text-muted-foreground">{pkg.id}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm shrink-0 text-right">
          <span className="text-muted-foreground">
            {orders.length} order{orders.length === 1 ? "" : "s"}
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
            {t.id === "orders" && orders.length > 0 ? (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">({orders.length})</span>
            ) : null}
            {t.id === "inventory" && sellable != null ? (
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">({sellable})</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-6 min-w-0 overflow-hidden">
        {activeTab === "details" ? (
          <PackageAdminPanel
            initial={pkg}
            races={races}
            section="details"
            onDeleted={() => router.push("/admin/catalog")}
          />
        ) : activeTab === "inventory" ? (
          <PackageAdminPanel initial={pkg} races={races} section="inventory" />
        ) : (
          <PackageOrdersTable orders={orders} />
        )}
      </div>
    </div>
  )
}
