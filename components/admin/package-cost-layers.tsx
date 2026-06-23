"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { addCostLayer, deleteCostLayer, updateCostLayer, updateCostLayerQuantity } from "@/app/(admin)/actions"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { LinkedInventoryPackage } from "@/lib/admin/linked-inventory"
import { linkedPackageSellable } from "@/lib/admin/linked-inventory"
import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { formatMoney } from "@/lib/format/money"

type Props = {
  packageId: string
  packageCurrency: string
  packageName: string
  packageDuration?: string | null
  /** Optional sale price for the package, used to preview margin against weighted cost. */
  salePrice: number | null
  layers: CostLayerRow[]
  salesBreakdown: PackageSalesBreakdown
  linkedPackages?: LinkedInventoryPackage[]
  /** Sellable for this package when not in a linked group. */
  sellable?: number
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatDateInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const tz = d.getTimezoneOffset()
  const local = new Date(d.getTime() - tz * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}

function soldCount(n: number): string {
  return String(Math.max(0, Math.floor(n)))
}

export function PackageCostLayers({
  packageId,
  packageCurrency,
  packageName,
  packageDuration = null,
  salePrice,
  layers,
  salesBreakdown,
  linkedPackages = [],
  sellable = 0,
}: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [addOpen, setAddOpen] = useState(false)
  const [addQty, setAddQty] = useState("")
  const [addCost, setAddCost] = useState("")
  const [addNote, setAddNote] = useState("")
  const [addSource, setAddSource] = useState("")
  const [addDate, setAddDate] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCost, setEditCost] = useState("")
  const [editNote, setEditNote] = useState("")
  const [editSource, setEditSource] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editQty, setEditQty] = useState("")
  const [editCascade, setEditCascade] = useState(true)

  const { totalRemaining, totalCostBasis, weightedCost } = useMemo(() => {
    let units = 0
    let cost = 0
    for (const l of layers) {
      if (l.quantity_remaining > 0) {
        units += l.quantity_remaining
        cost += l.unit_cost * l.quantity_remaining
      }
    }
    return {
      totalRemaining: units,
      totalCostBasis: cost,
      weightedCost: units > 0 ? cost / units : null,
    }
  }, [layers])

  const grossUnit = useMemo(() => {
    if (salePrice == null || weightedCost == null) return null
    return salePrice - weightedCost
  }, [salePrice, weightedCost])

  const grossMargin = useMemo(() => {
    if (grossUnit == null || salePrice == null || salePrice <= 0) return null
    return grossUnit / salePrice
  }, [grossUnit, salePrice])

  const isLinkedGroup = linkedPackages.length > 1

  const packageSalesRows = useMemo(() => {
    if (isLinkedGroup) {
      return linkedPackages.map((p) => ({
        id: p.id,
        name: p.name,
        duration: p.duration,
        salesBreakdown: p.sales_breakdown,
        sellable: linkedPackageSellable(p),
        isCurrent: p.id === packageId,
      }))
    }
    return [
      {
        id: packageId,
        name: packageName,
        duration: packageDuration,
        salesBreakdown,
        sellable,
        isCurrent: true,
      },
    ]
  }, [isLinkedGroup, linkedPackages, packageId, packageName, packageDuration, salesBreakdown, sellable])
  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => {
      const da = new Date(a.received_at).getTime()
      const db = new Date(b.received_at).getTime()
      if (da === db) return a.id.localeCompare(b.id)
      return da - db
    }),
    [layers],
  )

  function resetAddForm() {
    setAddQty("")
    setAddCost("")
    setAddNote("")
    setAddSource("")
    setAddDate("")
  }

  function submitAdd() {
    const q = Math.floor(Number(addQty))
    if (!Number.isFinite(q) || q <= 0) {
      toast.error("Quantity must be a positive whole number.")
      return
    }
    const c = Number(addCost)
    if (!Number.isFinite(c) || c < 0) {
      toast.error("Unit cost must be a non-negative number.")
      return
    }
    start(async () => {
      const res = await addCostLayer({
        packageId,
        quantity: q,
        unitCost: c,
        note: addNote.trim() || null,
        source: addSource.trim() || null,
        receivedAt: addDate || null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Stock added with buy price.")
      resetAddForm()
      setAddOpen(false)
      router.refresh()
    })
  }

  function startEdit(layer: CostLayerRow) {
    setEditingId(layer.id)
    setEditCost(String(layer.unit_cost))
    setEditNote(layer.note ?? "")
    setEditSource(layer.source ?? "")
    setEditDate(formatDateInput(layer.received_at))
    setEditQty(String(layer.quantity))
    setEditCascade(true)
  }

  function submitEdit(layer: CostLayerRow) {
    const c = Number(editCost)
    if (!Number.isFinite(c) || c < 0) {
      toast.error("Unit cost must be a non-negative number.")
      return
    }
    const newQty = Math.floor(Number(editQty))
    if (!Number.isFinite(newQty) || newQty < 0) {
      toast.error("Quantity must be a non-negative whole number.")
      return
    }
    const consumed = layer.quantity - layer.quantity_remaining
    if (newQty < consumed) {
      toast.error(`Quantity cannot be less than ${consumed} (units already sold from this layer).`)
      return
    }
    start(async () => {
      if (newQty !== layer.quantity) {
        const qtyRes = await updateCostLayerQuantity({
          layerId: layer.id,
          packageId,
          quantity: newQty,
        })
        if (!qtyRes.ok) {
          toast.error(qtyRes.message)
          return
        }
      }
      const res = await updateCostLayer({
        layerId: layer.id,
        packageId,
        unitCost: c,
        note: editNote,
        source: editSource,
        receivedAt: editDate || null,
        cascadeToConsumptions: editCascade,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const qtyChanged = newQty !== layer.quantity
      toast.success(
        qtyChanged
          ? editCascade
            ? "Cost layer updated; stock and historical sales adjusted."
            : "Cost layer updated; stock adjusted."
          : editCascade
            ? "Buy price updated (historical sales rewritten)."
            : "Buy price updated.",
      )
      setEditingId(null)
      router.refresh()
    })
  }

  function confirmDelete(layer: CostLayerRow) {
    if (
      !window.confirm(
        `Delete this cost layer (${layer.quantity} units @ ${formatMoney(layer.currency, layer.unit_cost)})? This will also reduce stock by ${layer.quantity}.`,
      )
    ) {
      return
    }
    start(async () => {
      const res = await deleteCostLayer(layer.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Cost layer deleted.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-4 min-w-0 w-full">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weighted buy price</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {weightedCost != null ? formatMoney(packageCurrency, weightedCost) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {totalRemaining} unit{totalRemaining === 1 ? "" : "s"} on hand · cost basis{" "}
            {totalRemaining > 0 ? formatMoney(packageCurrency, totalCostBasis) : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Current sale price</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {salePrice != null ? formatMoney(packageCurrency, salePrice) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">From package trade price</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 min-w-0 sm:col-span-2 lg:col-span-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gross profit / unit</p>
          <p
            className={`text-sm font-semibold tabular-nums break-words ${
              grossUnit == null ? "text-foreground" : grossUnit >= 0 ? "text-emerald-600" : "text-destructive"
            }`}
          >
            {grossUnit != null ? formatMoney(packageCurrency, grossUnit) : "—"}
          </p>
          {grossMargin != null ? (
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{formatPct(grossMargin)} margin</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground mt-0.5">Preview at weighted cost</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Places sold</p>
          {isLinkedGroup ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-primary/80">Linked inventory</span>
          ) : null}
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium text-right">Portal</th>
              <th className="px-3 py-2 font-medium text-right">Wix</th>
              <th className="px-3 py-2 font-medium text-right">Salesforce</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium text-right">Sellable</th>
            </tr>
          </thead>
          <tbody>
            {packageSalesRows.map((row) => {
              const duration = packageDurationLabel(row.duration)
              const label = duration ? `${row.name} · ${duration}` : row.name
              return (
                <tr
                  key={row.id}
                  className={
                    row.isCurrent
                      ? "border-t border-border bg-muted/15 font-medium text-foreground"
                      : "border-t border-border text-muted-foreground"
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {row.isCurrent ? (
                        <span>{label}</span>
                      ) : (
                        <Link
                          href={`/admin/catalog/${encodeURIComponent(row.id)}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {label}
                        </Link>
                      )}
                      {isLinkedGroup ? (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80 border border-border rounded px-1 py-px">
                          Linked
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(row.salesBreakdown.tradePortal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{soldCount(row.salesBreakdown.wix)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(row.salesBreakdown.salesforceOffline)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{soldCount(row.salesBreakdown.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{soldCount(row.sellable)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stock purchased</p>
        <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 font-medium text-right">Qty bought</th>
              <th className="px-3 py-2 font-medium text-right">Buy price</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium min-w-[11rem]" />
            </tr>
          </thead>
          <tbody>
            {sortedLayers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                  No cost layers yet. Use “Add stock + buy price” below.
                </td>
              </tr>
            ) : (
              sortedLayers.map((layer) => {
                const editing = editingId === layer.id
                const consumed = layer.quantity - layer.quantity_remaining
                return (
                  <tr key={layer.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {editing ? (
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="px-2 py-1 rounded border border-border bg-background text-xs"
                        />
                      ) : (
                        formatDisplayDate(layer.received_at)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {editing ? (
                        <div className="flex flex-col items-end gap-1">
                          <input
                            inputMode="numeric"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="w-[80px] px-2 py-1 rounded border border-border bg-background text-xs text-right"
                          />
                          <div className="text-[10px] text-muted-foreground">
                            {consumed > 0 ? `min ${consumed} (allocated to orders)` : "units purchased"}
                          </div>
                        </div>
                      ) : (
                        <div className="font-medium text-foreground">{layer.quantity}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {editing ? (
                        <input
                          inputMode="decimal"
                          value={editCost}
                          onChange={(e) => setEditCost(e.target.value)}
                          className="w-[110px] px-2 py-1 rounded border border-border bg-background text-xs text-right"
                        />
                      ) : (
                        <span className={layer.unit_cost === 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground"}>
                          {formatMoney(layer.currency, layer.unit_cost)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {editing ? (
                        <input
                          value={editSource}
                          onChange={(e) => setEditSource(e.target.value)}
                          placeholder="e.g. F1 Direct"
                          className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                        />
                      ) : (
                        <span className={layer.source ? "" : "text-muted-foreground/60"}>{layer.source || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {editing ? (
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Optional note"
                          className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                        />
                      ) : (
                        <span className={layer.note ? "" : "text-muted-foreground/60"}>{layer.note || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top min-w-[11rem]">
                      {editing ? (
                        <div className="flex flex-col items-stretch gap-1.5 w-full min-w-[10rem]">
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={editCascade}
                              onChange={(e) => setEditCascade(e.target.checked)}
                            />
                            Update past order costs
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setEditingId(null)}
                              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => submitEdit(layer)}
                              className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3 justify-end">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => startEdit(layer)}
                            className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                          >
                            Edit
                          </button>
                          {consumed === 0 ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => confirmDelete(layer)}
                              className="text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-3">
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="text-sm font-medium text-primary hover:underline"
        >
          {addOpen ? "Cancel adding stock" : "Add stock + buy price"}
        </button>
        {addOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted-foreground">
              Quantity added
              <input
                inputMode="numeric"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                placeholder="e.g. 10"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Unit buy price ({packageCurrency})
              <input
                inputMode="decimal"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
                placeholder="e.g. 2500"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Received date (optional)
              <input
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Source (who we bought from)
              <input
                value={addSource}
                onChange={(e) => setAddSource(e.target.value)}
                placeholder="e.g. F1 Direct"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Note (optional)
              <input
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="Supplier reference, batch, etc."
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => submitAdd()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Add stock
              </button>
              <p className="text-[11px] text-muted-foreground mt-2">
                Increases capacity by the quantity above and links the new units to this buy price. Future sales consume layers in receive-date order (FIFO). The Source is pushed to the Salesforce product so you can see who the stock was bought from.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
