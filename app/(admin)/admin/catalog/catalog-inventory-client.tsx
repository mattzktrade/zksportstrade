"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import { salesforcePlacesSold } from "@/lib/admin/package-sales-breakdown"
import {
  clearCatalogClientCache,
  readCatalogClientCache,
  writeCatalogClientCache,
} from "@/lib/admin/catalog-client-cache"
import { fetchAdminCatalogList, fetchInventoryCsvRows } from "@/app/(admin)/actions"
import { CatalogNewPackage } from "./catalog-new-package"
import { CatalogAdminTable } from "./catalog-admin-table"

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadInventoryCsv(rows: AdminPackageRow[]): void {
  const headers = [
    "Race",
    "Package",
    "Circuit",
    "Date range",
    "Location",
    "Price",
    "Currency",
    "Total stock started",
    "Salesforce sold",
    "Portal available",
    "On hold",
    "Available left",
    "Package ID",
  ]
  const body = rows.map((p) => {
    const portalAvailable = Number(p.inventory?.qty_available ?? 0)
    const held = Number(p.inventory?.qty_held ?? 0)
    const portalStockPurchased =
      p.cost_layers.reduce((sum, layer) => sum + Number(layer.quantity ?? 0), 0) ||
      Number(p.layer_units_purchased ?? 0)
    const salesforceStock = p.salesforce_inventory?.stock
    const totalStockStarted = salesforceStock ?? Math.max(portalStockPurchased, portalAvailable)
    const salesforceSold =
      p.salesforce_inventory?.quantitySold ?? salesforcePlacesSold(p.sales_breakdown)
    return [
      p.race_name,
      p.name,
      p.circuit,
      p.date_range,
      p.location,
      p.trade_price ?? "",
      p.currency,
      totalStockStarted,
      salesforceSold,
      portalAvailable,
      held,
      Math.max(0, portalAvailable - held),
      p.id,
    ]
  })
  const csv = [headers, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `zk-inventory-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function CatalogInventoryClient({ races }: { races: AdminRaceOption[] }) {
  const [rows, setRows] = useState<AdminPackageRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [csvLoading, setCsvLoading] = useState(false)

  useLayoutEffect(() => {
    const cached = readCatalogClientCache()
    if (cached?.rows.length) {
      setRows(cached.rows)
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fresh = await fetchAdminCatalogList()
      if (cancelled) return
      if (fresh.length > 0) {
        setRows(fresh)
        writeCatalogClientCache(fresh, races)
      }
      setListLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [races])

  async function handleExportCsv() {
    setCsvLoading(true)
    try {
      const csvRows = await fetchInventoryCsvRows()
      downloadInventoryCsv(csvRows.length > 0 ? csvRows : rows)
    } finally {
      setCsvLoading(false)
    }
  }

  function handlePackageCreated() {
    clearCatalogClientCache()
    setListLoading(true)
    void fetchAdminCatalogList().then((fresh) => {
      if (fresh.length > 0) {
        setRows(fresh)
        writeCatalogClientCache(fresh, races)
      }
      setListLoading(false)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage packages, stock, pricing, and listings. Open a product for full detail, integrations, and cost
            layers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={csvLoading || listLoading}
            className="shrink-0 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {csvLoading ? "Preparing CSV…" : "Export inventory CSV"}
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
          >
            Create new package
          </button>
        </div>
      </div>

      <CatalogNewPackage
        races={races}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handlePackageCreated}
      />

      {listLoading && rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground animate-pulse">
          Loading inventory…
        </div>
      ) : (
        <CatalogAdminTable rows={rows} races={races} />
      )}
    </div>
  )
}
