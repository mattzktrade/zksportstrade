"use client"

import { useState } from "react"
import type { AdminPackageRow, AdminRaceOption } from "@/lib/admin/queries"
import type { WixChannelListingRow } from "@/lib/admin/wix-channel-listings"
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
    "Stock",
    "On hold",
    "Sellable",
    "Package ID",
  ]
  const body = rows.map((p) => {
    const stock = Number(p.inventory?.qty_available ?? 0)
    const held = Number(p.inventory?.qty_held ?? 0)
    return [
      p.race_name,
      p.name,
      p.circuit,
      p.date_range,
      p.location,
      p.trade_price ?? "",
      p.currency,
      stock,
      held,
      Math.max(0, stock - held),
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

export function CatalogInventoryClient({
  rows,
  races,
  wixListingsByPackage,
}: {
  rows: AdminPackageRow[]
  races: AdminRaceOption[]
  wixListingsByPackage: Record<string, WixChannelListingRow[]>
}) {
  const [createOpen, setCreateOpen] = useState(false)

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
            onClick={() => downloadInventoryCsv(rows)}
            className="shrink-0 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted"
          >
            Export inventory CSV
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

      <CatalogNewPackage races={races} open={createOpen} onOpenChange={setCreateOpen} />
      <CatalogAdminTable rows={rows} races={races} wixListingsByPackage={wixListingsByPackage} />
    </div>
  )
}
