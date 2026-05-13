"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { insertPackageInventory, updateInventoryRow, updatePackageFields } from "@/app/(admin)/actions"

export type CatalogAdminRow = {
  id: string
  name: string
  race_name: string
  trade_price: number | null
  is_enquiry: boolean
  featured: boolean
  sort_order: number
  inventory: { qty_available: number; qty_held: number } | null
}

export function CatalogAdminTable({ rows }: { rows: CatalogAdminRow[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [rows],
  )

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No packages in the database. Run the catalog seed after migrations.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {sorted.map((row) => (
        <CatalogRow key={row.id} initial={row} />
      ))}
    </div>
  )
}

function CatalogRow({ initial }: { initial: CatalogAdminRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [tradePrice, setTradePrice] = useState(
    initial.trade_price != null ? String(initial.trade_price) : "",
  )
  const [isEnquiry, setIsEnquiry] = useState(initial.is_enquiry)
  const [featured, setFeatured] = useState(initial.featured)
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order))
  const [qtyAvailable, setQtyAvailable] = useState(String(initial.inventory?.qty_available ?? 0))
  const [qtyHeld, setQtyHeld] = useState(String(initial.inventory?.qty_held ?? 0))

  function parsePrice(): number | null {
    const t = tradePrice.trim()
    if (t === "") return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return n
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
      const res = await updatePackageFields({
        packageId: initial.id,
        trade_price: price,
        is_enquiry: isEnquiry,
        featured,
        sort_order: so,
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

  const sellable =
    initial.inventory != null ? Math.max(0, initial.inventory.qty_available - initial.inventory.qty_held) : null

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">{initial.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {initial.race_name} · <span className="font-mono">{initial.id}</span>
          </p>
          {sellable != null && (
            <p className="text-xs text-muted-foreground mt-1">
              Sellable units (computed): <span className="font-medium text-foreground">{sellable}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package</p>
          <label className="block text-xs text-muted-foreground">
            Trade price (leave blank if enquiry-only)
            <input
              value={tradePrice}
              onChange={(e) => setTradePrice(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isEnquiry} onChange={(e) => setIsEnquiry(e.target.checked)} />
            Enquiry package (hides firm availability in portal)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            Featured
          </label>
          <label className="block text-xs text-muted-foreground">
            Sort order
            <input
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="mt-1 w-full max-w-[120px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => savePackage()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Save package
          </button>
        </div>

        <div className="space-y-3 border-t lg:border-t-0 lg:border-l border-border pt-4 lg:pt-0 lg:pl-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inventory</p>
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-muted-foreground">
                  Qty capacity (available ceiling)
                  <input
                    value={qtyAvailable}
                    onChange={(e) => setQtyAvailable(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Qty held (includes active holds)
                  <input
                    value={qtyHeld}
                    onChange={(e) => setQtyHeld(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Held units must stay at or below capacity. Client holds also update held counts via the inventory page.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => saveInventory()}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Save inventory
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
