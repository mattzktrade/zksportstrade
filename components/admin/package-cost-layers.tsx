"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  addStockPurchaseLayer,
  deleteCostLayer,
  importPackageStockSourcesFromSalesforce,
  updateCostLayer,
  updateCostLayerQuantity,
  updateOrphanPackageStock,
} from "@/app/(admin)/actions"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { FulfilmentBlockRow } from "@/lib/admin/fulfilment-blocks"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import type { LinkedInventoryPackage, LinkedInventoryShellPackage } from "@/lib/admin/linked-inventory"
import type { PackageSalesBreakdown } from "@/lib/admin/package-sales-breakdown"
import {
  linkedPoolSellableForPackage,
  salesforceClosedWonSold,
  type LinkedSellableMember,
} from "@/lib/admin/package-sales-breakdown"
import { resolveSoldByCostLayer } from "@/lib/integrations/salesforce/stock-sources"
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
  linkedShellPackages?: LinkedInventoryShellPackage[]
  /**
   * Admin commitment sellable (stock − closed-won − pipeline − portal/Wix).
   * Can be negative when oversold.
   */
  sellable?: number
  /** Total stock units (SF Stock or cost-layer sum) for commitment sellable on linked rows. */
  stockTotal?: number
  /**
   * Portal qty_available. When there are no cost layers but this is &gt; 0, stock exists
   * without a purchase row — we show an editable "untracked stock" row.
   */
  qtyAvailable?: number
  /** All purchase orders (any supplier) — layer can pick one, supplier auto-fills. */
  purchaseOrders?: PurchaseOrderRow[]
  /** Fulfilment blocks scoped to this package. */
  fulfilmentBlocks?: FulfilmentBlockRow[]
  /** When set, show "Import from Salesforce Stock Sources" for empty ledgers. */
  hasSalesforceProduct?: boolean
  /** Refetch package inventory into parent state (preferred over router.refresh alone). */
  onInventoryChanged?: () => Promise<void> | void
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
  return String(Math.floor(n))
}

const LINKED_DAY_DURATIONS = new Set([
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
  "2_day",
])

export function PackageCostLayers({
  packageId,
  packageCurrency,
  packageName,
  packageDuration = null,
  salePrice,
  layers,
  salesBreakdown,
  linkedPackages = [],
  linkedShellPackages = [],
  sellable = 0,
  stockTotal,
  qtyAvailable = 0,
  purchaseOrders = [],
  fulfilmentBlocks = [],
  hasSalesforceProduct = false,
  onInventoryChanged,
}: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const addFileRef = useRef<HTMLInputElement | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addQty, setAddQty] = useState("")
  const [addCost, setAddCost] = useState("")
  const [addNote, setAddNote] = useState("")
  const [addSupplier, setAddSupplier] = useState("")
  const [addPoNumber, setAddPoNumber] = useState("")
  const [addPoIssuedAt, setAddPoIssuedAt] = useState("")
  const [addDate, setAddDate] = useState("")

  async function refreshInventoryUi() {
    if (onInventoryChanged) {
      await onInventoryChanged()
      return
    }
    router.refresh()
  }
  const [addFulfilmentBlockId, setAddFulfilmentBlockId] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCost, setEditCost] = useState("")
  const [editNote, setEditNote] = useState("")
  const [editSupplier, setEditSupplier] = useState("")
  const [editPoNumber, setEditPoNumber] = useState("")
  const [editPoIssuedAt, setEditPoIssuedAt] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editQty, setEditQty] = useState("")
  const [editCascade, setEditCascade] = useState(true)
  const [editFulfilmentBlockId, setEditFulfilmentBlockId] = useState("")
  const [orphanEditing, setOrphanEditing] = useState(false)
  const [orphanQty, setOrphanQty] = useState("")
  const [orphanConvert, setOrphanConvert] = useState(false)
  const [orphanSupplier, setOrphanSupplier] = useState("")
  const [orphanCost, setOrphanCost] = useState("0")
  const [orphanNote, setOrphanNote] = useState("")
  const [orphanDate, setOrphanDate] = useState("")
  const [orphanPoNumber, setOrphanPoNumber] = useState("")
  const [orphanPoIssuedAt, setOrphanPoIssuedAt] = useState("")
  const [orphanBlockId, setOrphanBlockId] = useState("")

  const duration = packageDuration?.trim() || null
  const inheritsSharedLedger =
    layers.length === 0 &&
    !!duration &&
    LINKED_DAY_DURATIONS.has(duration) &&
    linkedPackages.length > 1

  const sharedLedgerParent = useMemo(() => {
    if (!inheritsSharedLedger) return null
    const withLayers = linkedPackages.filter((p) => (p.cost_layers?.length ?? 0) > 0)
    return (
      withLayers.find((p) => p.duration === "3_day") ??
      withLayers.find((p) => p.id !== packageId) ??
      null
    )
  }, [inheritsSharedLedger, linkedPackages, packageId])

  const displayLayers = sharedLedgerParent?.cost_layers?.length
    ? sharedLedgerParent.cost_layers
    : layers
  const isSharedLedgerView = !!sharedLedgerParent && displayLayers.length > 0 && layers.length === 0

  // Seeded linked-day qty is shared pool capacity — not orphan stock missing a purchase row.
  const hasOrphanStock = layers.length === 0 && qtyAvailable > 0 && !isSharedLedgerView

  const resolvedStockTotal = useMemo(() => {
    if (stockTotal != null && Number.isFinite(stockTotal) && stockTotal > 0) {
      return Math.max(0, Math.floor(stockTotal))
    }
    const fromLayers = displayLayers.reduce(
      (sum, l) => sum + Math.max(0, Math.floor(Number(l.quantity) || 0)),
      0,
    )
    return fromLayers > 0 ? fromLayers : Math.max(0, Math.floor(qtyAvailable))
  }, [stockTotal, displayLayers, qtyAvailable])

  /** Closed-won places sold attributed to this package's stock pool (excl. open pipeline). */
  const poolSoldTotal = useMemo(() => {
    let total = salesforceClosedWonSold(salesBreakdown)
    if (linkedPackages.length > 1) {
      for (const p of linkedPackages) {
        if (p.id === packageId) continue
        total += salesforceClosedWonSold(p.sales_breakdown)
      }
    }
    // Also count portal / Wix bookings on this package (and linked siblings).
    total += Math.max(0, Math.floor(salesBreakdown.wix) + Math.floor(salesBreakdown.tradePortal))
    if (linkedPackages.length > 1) {
      for (const p of linkedPackages) {
        if (p.id === packageId) continue
        total +=
          Math.max(0, Math.floor(p.sales_breakdown.wix)) +
          Math.max(0, Math.floor(p.sales_breakdown.tradePortal))
      }
    }
    return total
  }, [salesBreakdown, linkedPackages, packageId])

  const soldByLayerId = useMemo(
    () =>
      resolveSoldByCostLayer({
        layers: displayLayers,
        totalPackageSold: poolSoldTotal,
      }),
    [displayLayers, poolSoldTotal],
  )

  const purchaseOrderById = useMemo(
    () => new Map(purchaseOrders.map((po) => [po.id, po])),
    [purchaseOrders],
  )
  const blockById = useMemo(
    () => new Map(fulfilmentBlocks.map((b) => [b.id, b])),
    [fulfilmentBlocks],
  )
  const uniqueSuppliers = useMemo(() => {
    const names = new Set<string>()
    for (const po of purchaseOrders) {
      const s = po.supplier.trim()
      if (s) names.add(s)
    }
    for (const layer of displayLayers) {
      const s = layer.source?.trim()
      if (s) names.add(s)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [purchaseOrders, displayLayers])

  const { totalRemaining, totalCostBasis, weightedCost } = useMemo(() => {
    let units = 0
    let cost = 0
    for (const l of displayLayers) {
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
  }, [displayLayers])

  const grossUnit = useMemo(() => {
    if (salePrice == null || weightedCost == null) return null
    return salePrice - weightedCost
  }, [salePrice, weightedCost])

  const grossMargin = useMemo(() => {
    if (grossUnit == null || salePrice == null || salePrice <= 0) return null
    return grossUnit / salePrice
  }, [grossUnit, salePrice])

  const isLinkedGroup = linkedPackages.length > 1 || linkedShellPackages.length > 0

  const linkedMembers: LinkedSellableMember[] = useMemo(
    () =>
      linkedPackages.map((p) => ({
        id: p.id,
        duration: p.duration,
        breakdown: p.id === packageId ? salesBreakdown : p.sales_breakdown,
      })),
    [linkedPackages, packageId, salesBreakdown],
  )

  const packageSalesRows = useMemo(() => {
    type Row = {
      id: string
      name: string
      duration: string | null
      salesBreakdown: PackageSalesBreakdown
      sellable: number | null
      isCurrent: boolean
      isShell?: boolean
    }

    if (isLinkedGroup) {
      const packageRows: Row[] = linkedPackages.map((p) => ({
        id: p.id,
        name: p.name,
        duration: p.duration,
        salesBreakdown: p.id === packageId ? salesBreakdown : p.sales_breakdown,
        sellable: linkedPoolSellableForPackage({
          stock: resolvedStockTotal,
          targetId: p.id,
          targetDuration: p.duration,
          members: linkedMembers,
        }),
        isCurrent: p.id === packageId,
      }))
      const shellRows: Row[] = linkedShellPackages.map((sh) => ({
        id: sh.id,
        name: sh.name,
        duration: sh.duration,
        salesBreakdown: sh.sales_breakdown,
        sellable: linkedPoolSellableForPackage({
          stock: resolvedStockTotal,
          targetId: sh.id,
          targetDuration: sh.duration,
          members: linkedMembers,
          shellMirrorDuration: sh.duration,
        }),
        isCurrent: sh.id === packageId,
        isShell: true,
      }))
      return [...packageRows, ...shellRows]
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
  }, [
    isLinkedGroup,
    linkedPackages,
    linkedShellPackages,
    linkedMembers,
    packageId,
    packageName,
    packageDuration,
    salesBreakdown,
    sellable,
    resolvedStockTotal,
  ])
  const sortedLayers = useMemo(
    () => [...displayLayers].sort((a, b) => {
      const da = new Date(a.received_at).getTime()
      const db = new Date(b.received_at).getTime()
      if (da === db) return a.id.localeCompare(b.id)
      return da - db
    }),
    [displayLayers],
  )

  function resetAddForm() {
    setAddQty("")
    setAddCost("")
    setAddNote("")
    setAddSupplier("")
    setAddPoNumber("")
    setAddPoIssuedAt("")
    setAddDate("")
    setAddFulfilmentBlockId("")
    if (addFileRef.current) addFileRef.current.value = ""
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
    if (!addSupplier.trim()) {
      toast.error("Supplier is required — a purchase order is created automatically.")
      return
    }
    start(async () => {
      const fd = new FormData()
      fd.set("packageId", packageId)
      fd.set("quantity", String(q))
      fd.set("unitCost", String(c))
      fd.set("supplier", addSupplier.trim())
      if (addPoNumber.trim()) fd.set("poNumber", addPoNumber.trim())
      if (addPoIssuedAt.trim()) fd.set("poIssuedAt", addPoIssuedAt.trim())
      if (addNote.trim()) fd.set("note", addNote.trim())
      if (addDate.trim()) fd.set("receivedAt", addDate.trim())
      if (addFulfilmentBlockId.trim()) fd.set("fulfilmentBlockId", addFulfilmentBlockId.trim())
      const file = addFileRef.current?.files?.[0]
      if (file && file.size > 0) fd.set("file", file)

      const res = await addStockPurchaseLayer(fd)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Stock added with purchase order.")
      resetAddForm()
      setAddOpen(false)
      await refreshInventoryUi()
    })
  }

  function startEdit(layer: CostLayerRow) {
    const linkedPo = layer.purchase_order_id ? purchaseOrderById.get(layer.purchase_order_id) : null
    setEditingId(layer.id)
    setEditCost(String(layer.unit_cost))
    setEditNote(layer.note ?? "")
    setEditSupplier(linkedPo?.supplier ?? layer.source ?? "")
    setEditPoNumber(linkedPo?.po_number ?? "")
    setEditPoIssuedAt(linkedPo?.issued_at ?? "")
    setEditDate(formatDateInput(layer.received_at))
    setEditQty(String(layer.quantity))
    setEditCascade(true)
    setEditFulfilmentBlockId(layer.fulfilment_block_id ?? "")
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
    if (!editSupplier.trim()) {
      toast.error("Supplier is required.")
      return
    }
    const consumed = layer.quantity - layer.quantity_remaining
    if (newQty < consumed) {
      toast.error(`Quantity cannot be less than ${consumed} (units already sold from this layer).`)
      return
    }
    const nextBlockId = editFulfilmentBlockId.trim() || null
    const blockChanged = (layer.fulfilment_block_id ?? null) !== nextBlockId
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
        receivedAt: editDate || null,
        cascadeToConsumptions: editCascade,
        purchaseOrderSupplier: editSupplier.trim(),
        purchaseOrderNumber: editPoNumber.trim() || null,
        purchaseOrderIssuedAt: editPoIssuedAt.trim() || null,
        fulfilmentBlockId: blockChanged ? nextBlockId : undefined,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      const qtyChanged = newQty !== layer.quantity
      toast.success(
        qtyChanged
          ? editCascade
            ? "Stock purchase updated; stock and historical sales adjusted."
            : "Stock purchase updated."
          : editCascade
            ? "Buy price updated (historical sales rewritten)."
            : "Stock purchase updated.",
      )
      setEditingId(null)
      await refreshInventoryUi()
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
      await refreshInventoryUi()
    })
  }

  function beginOrphanEdit() {
    setOrphanEditing(true)
    setOrphanQty(String(qtyAvailable))
    setOrphanConvert(false)
    setOrphanSupplier("")
    setOrphanCost("0")
    setOrphanNote("")
    setOrphanDate("")
    setOrphanPoNumber("")
    setOrphanPoIssuedAt("")
    setOrphanBlockId("")
  }

  function submitOrphanEdit() {
    const newQty = Math.floor(Number(orphanQty))
    if (!Number.isFinite(newQty) || newQty < 0) {
      toast.error("Quantity must be a non-negative whole number.")
      return
    }
    if (orphanConvert) {
      if (!orphanSupplier.trim()) {
        toast.error("Supplier is required to record a stock purchase.")
        return
      }
      if (newQty <= 0) {
        toast.error("Quantity must be greater than zero to create a stock purchase.")
        return
      }
      const c = Number(orphanCost)
      if (!Number.isFinite(c) || c < 0) {
        toast.error("Buy price must be a non-negative number.")
        return
      }
    }
    start(async () => {
      const res = await updateOrphanPackageStock({
        packageId,
        quantity: newQty,
        convertToPurchase: orphanConvert
          ? {
              supplier: orphanSupplier.trim(),
              unitCost: Number(orphanCost),
              note: orphanNote.trim() || null,
              poNumber: orphanPoNumber.trim() || null,
              poIssuedAt: orphanPoIssuedAt.trim() || null,
              receivedAt: orphanDate.trim() || null,
              fulfilmentBlockId: orphanBlockId.trim() || null,
            }
          : null,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Stock updated.")
      setOrphanEditing(false)
      await refreshInventoryUi()
    })
  }

  function confirmClearOrphanStock() {
    if (
      !window.confirm(
        `Clear this untracked stock (${qtyAvailable} units)? Available inventory will be set to 0. This cannot be undone except by adding stock again.`,
      )
    ) {
      return
    }
    start(async () => {
      const res = await updateOrphanPackageStock({ packageId, quantity: 0 })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Untracked stock cleared.")
      setOrphanEditing(false)
      await refreshInventoryUi()
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
              <th className="px-3 py-2 font-medium text-right">SF pipeline</th>
              <th className="px-3 py-2 font-medium text-right">Total sold</th>
              <th className="px-3 py-2 font-medium text-right">Sellable</th>
            </tr>
          </thead>
          <tbody>
            {packageSalesRows.map((row) => {
              const duration = packageDurationLabel(row.duration)
              const label = duration ? `${row.name} · ${duration}` : row.name
              const rowClass = row.isShell
                ? "border-t border-border bg-muted/20 text-muted-foreground"
                : row.isCurrent
                  ? "border-t border-border bg-muted/15 font-medium text-foreground"
                  : "border-t border-border text-muted-foreground"
              return (
                <tr key={row.id} className={rowClass}>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {row.isShell || row.isCurrent ? (
                        <span>{label}</span>
                      ) : (
                        <Link
                          href={`/admin/catalog/${encodeURIComponent(row.id)}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {label}
                        </Link>
                      )}
                      {row.isShell ? (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80 border border-border rounded px-1 py-px">
                          Shell
                        </span>
                      ) : isLinkedGroup ? (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80 border border-border rounded px-1 py-px">
                          Linked
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.isShell ? "—" : soldCount(row.salesBreakdown.tradePortal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.isShell ? "—" : soldCount(row.salesBreakdown.wix)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.isShell ? "—" : soldCount(salesforceClosedWonSold(row.salesBreakdown))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.isShell
                      ? "—"
                      : soldCount(Math.max(0, Math.floor(row.salesBreakdown.salesforceOpenPipeline)))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.isShell
                      ? soldCount(salesforceClosedWonSold(row.salesBreakdown))
                      : soldCount(
                          Math.max(0, Math.floor(row.salesBreakdown.wix)) +
                            Math.max(0, Math.floor(row.salesBreakdown.tradePortal)) +
                            salesforceClosedWonSold(row.salesBreakdown),
                        )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.sellable != null ? (
                      <span className={row.sellable < 0 ? "text-destructive font-medium" : undefined}>
                        {soldCount(row.sellable)}
                      </span>
                    ) : (
                      <span className="italic text-muted-foreground/80">mirrors day</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stock purchased</p>
        {isSharedLedgerView && sharedLedgerParent ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/30 px-3 py-2">
            Purchases live on the linked{" "}
            <Link
              href={`/admin/catalog/${encodeURIComponent(sharedLedgerParent.id)}?tab=inventory`}
              className="font-medium text-primary hover:underline"
            >
              {sharedLedgerParent.name}
            </Link>{" "}
            (3-day package). This day package shares that stock pool — sales here consume the same
            supplier layers (same as Salesforce Stock Sources). Edit purchases on the 3-day package.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Sold / Left count closed-won and portal bookings only — open SF pipeline holds Remaining but does
            not consume purchase layers until Closed Won. Portal/Wix orders synced to Salesforce appear under
            Portal or Wix only (not again under SF pipeline).
          </p>
        )}
        <datalist id="supplier-suggestions">
          {uniqueSuppliers.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-xs min-w-[860px]">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 font-medium text-right">Qty bought</th>
              <th className="px-3 py-2 font-medium text-right">Sold</th>
              <th className="px-3 py-2 font-medium text-right">Left</th>
              <th className="px-3 py-2 font-medium text-right">Buy price</th>
              <th className="px-3 py-2 font-medium">Purchase</th>
              <th className="px-3 py-2 font-medium">Block</th>
              <th className="px-3 py-2 font-medium">Note</th>
              <th className="px-3 py-2 font-medium min-w-[11rem]" />
            </tr>
          </thead>
          <tbody>
            {sortedLayers.length === 0 && !hasOrphanStock ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">
                  No cost layers yet. Use &ldquo;Add stock purchase&rdquo; below.
                </td>
              </tr>
            ) : null}
            {hasOrphanStock ? (
              <tr className="border-t border-border align-top bg-amber-50/40 dark:bg-amber-950/20">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {orphanEditing ? (
                    <input
                      type="date"
                      value={orphanDate}
                      onChange={(e) => setOrphanDate(e.target.value)}
                      disabled={!orphanConvert || pending}
                      className="px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-50"
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {orphanEditing ? (
                    <input
                      inputMode="numeric"
                      value={orphanQty}
                      onChange={(e) => setOrphanQty(e.target.value)}
                      disabled={pending}
                      className="w-[80px] px-2 py-1 rounded border border-border bg-background text-xs text-right"
                    />
                  ) : (
                    <div className="font-medium text-foreground">{qtyAvailable}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {orphanEditing ? "—" : qtyAvailable}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {orphanEditing && orphanConvert ? (
                    <input
                      inputMode="decimal"
                      value={orphanCost}
                      onChange={(e) => setOrphanCost(e.target.value)}
                      disabled={pending}
                      className="w-[110px] px-2 py-1 rounded border border-border bg-background text-xs text-right"
                    />
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {orphanEditing && orphanConvert ? (
                    <div className="flex flex-col gap-1.5 min-w-[140px]">
                      <input
                        value={orphanSupplier}
                        onChange={(e) => setOrphanSupplier(e.target.value)}
                        placeholder="Supplier"
                        list="supplier-suggestions"
                        disabled={pending}
                        className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                      />
                      <input
                        value={orphanPoNumber}
                        onChange={(e) => setOrphanPoNumber(e.target.value)}
                        placeholder="PO / invoice ref"
                        disabled={pending}
                        className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                      />
                      <input
                        type="date"
                        value={orphanPoIssuedAt}
                        onChange={(e) => setOrphanPoIssuedAt(e.target.value)}
                        disabled={pending}
                        className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                      />
                    </div>
                  ) : (
                    <span className="italic text-amber-800/90 dark:text-amber-200/90">Untracked stock</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {orphanEditing && orphanConvert && fulfilmentBlocks.length > 0 ? (
                    <select
                      value={orphanBlockId}
                      onChange={(e) => setOrphanBlockId(e.target.value)}
                      disabled={pending}
                      className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                    >
                      <option value="">— no block —</option>
                      {fulfilmentBlocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {orphanEditing ? (
                    <div className="flex flex-col gap-1.5 min-w-[160px]">
                      <label className="flex items-start gap-1.5 text-[11px] text-foreground">
                        <input
                          type="checkbox"
                          checked={orphanConvert}
                          onChange={(e) => setOrphanConvert(e.target.checked)}
                          disabled={pending}
                          className="mt-0.5"
                        />
                        <span>Record as stock purchase (supplier + buy price)</span>
                      </label>
                      {orphanConvert ? (
                        <input
                          value={orphanNote}
                          onChange={(e) => setOrphanNote(e.target.value)}
                          placeholder="Optional note"
                          disabled={pending}
                          className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                        />
                      ) : (
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Change quantity only, or tick above to create a proper purchase row.
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] leading-relaxed">
                      Inventory without a purchase row — edit quantity or convert to a stock purchase.
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top min-w-[11rem]">
                  {orphanEditing ? (
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setOrphanEditing(false)}
                        className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={submitOrphanEdit}
                        className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3 justify-end">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={beginOrphanEdit}
                        className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={confirmClearOrphanStock}
                        className="text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : null}
            {sortedLayers.map((layer) => {
                const editing = editingId === layer.id
                const consumed = layer.quantity - layer.quantity_remaining
                const attributedSold = Math.max(0, Math.floor(soldByLayerId.get(layer.id) ?? consumed))
                const left = Math.max(0, layer.quantity - attributedSold)
                const linkedPo = layer.purchase_order_id ? purchaseOrderById.get(layer.purchase_order_id) : null
                const linkedBlock = layer.fulfilment_block_id ? blockById.get(layer.fulfilment_block_id) : null
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
                      <div className="font-medium text-foreground">{attributedSold}</div>
                      {attributedSold > consumed ? (
                        <div className="text-[10px] text-muted-foreground">incl. offline SF</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="font-medium text-foreground">{left}</div>
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
                        <div className="flex flex-col gap-1.5 min-w-[140px]">
                          <input
                            value={editSupplier}
                            onChange={(e) => setEditSupplier(e.target.value)}
                            placeholder="Supplier"
                            list="supplier-suggestions"
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                          <input
                            value={editPoNumber}
                            onChange={(e) => setEditPoNumber(e.target.value)}
                            placeholder="PO / invoice ref"
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                          <input
                            type="date"
                            value={editPoIssuedAt}
                            onChange={(e) => setEditPoIssuedAt(e.target.value)}
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                        </div>
                      ) : linkedPo ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground">{linkedPo.supplier}</span>
                          <Link
                            href="/admin/purchase-orders"
                            className="text-[10px] text-primary hover:underline w-fit"
                          >
                            PO {linkedPo.po_number}
                          </Link>
                        </div>
                      ) : layer.source ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{layer.source}</span>
                          <span className="text-[10px] italic text-muted-foreground/70">No PO yet — edit to add</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {editing ? (
                        fulfilmentBlocks.length > 0 ? (
                          <select
                            value={editFulfilmentBlockId}
                            onChange={(e) => setEditFulfilmentBlockId(e.target.value)}
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          >
                            <option value="">— no block —</option>
                            {fulfilmentBlocks.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/70 italic">
                            Add blocks below
                          </span>
                        )
                      ) : (
                        <span className={linkedBlock ? "" : "text-muted-foreground/60"}>
                          {linkedBlock?.name ?? "—"}
                        </span>
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
                      ) : isSharedLedgerView && sharedLedgerParent ? (
                        <div className="text-right text-[10px] text-muted-foreground leading-snug">
                          Shared ledger — edit on{" "}
                          <Link
                            href={`/admin/catalog/${encodeURIComponent(sharedLedgerParent.id)}?tab=inventory`}
                            className="text-primary hover:underline"
                          >
                            3-day package
                          </Link>
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
              })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-3">
        {hasOrphanStock ? (
          <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
            This package already has {qtyAvailable} untracked unit{qtyAvailable === 1 ? "" : "s"}. Prefer{" "}
            <strong>Edit</strong> on that row (optionally convert to a purchase) instead of adding another
            purchase, or stock will be counted twice.
          </p>
        ) : null}
        {isSharedLedgerView && sharedLedgerParent ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            To add or change stock purchases, open the{" "}
            <Link
              href={`/admin/catalog/${encodeURIComponent(sharedLedgerParent.id)}?tab=inventory`}
              className="font-medium text-primary hover:underline"
            >
              {sharedLedgerParent.name}
            </Link>{" "}
            inventory tab. Do not add purchases here — that would double-count the linked pool.
          </p>
        ) : (
          <>
            {layers.length === 0 && hasSalesforceProduct ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    start(async () => {
                      const res = await importPackageStockSourcesFromSalesforce(packageId)
                      if (!res.ok) {
                        toast.error(res.message)
                        return
                      }
                      toast.success(res.message ?? "Stock sources imported.")
                      await refreshInventoryUi()
                    })
                  }}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  Import stock purchases from Salesforce
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Records supplier / qty from SF Stock Sources without adding extra sellable stock.
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {addOpen ? "Cancel adding stock" : "Add stock purchase"}
            </button>
          </>
        )}
        {addOpen && !isSharedLedgerView && (
          <div className="space-y-4">
            <datalist id="supplier-suggestions">
              {uniqueSuppliers.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Purchase order
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
                A purchase order is created automatically and linked to this stock. Re-use the same PO
                reference if you are adding more units from an existing contract.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Supplier
                  <input
                    value={addSupplier}
                    onChange={(e) => setAddSupplier(e.target.value)}
                    placeholder="e.g. F1 Direct"
                    list="supplier-suggestions"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  PO / invoice reference (optional)
                  <input
                    value={addPoNumber}
                    onChange={(e) => setAddPoNumber(e.target.value)}
                    placeholder="Leave blank to auto-generate"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  PO date (optional)
                  <input
                    type="date"
                    value={addPoIssuedAt}
                    onChange={(e) => setAddPoIssuedAt(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Attach contract / invoice (optional)
                  <input
                    ref={addFileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                    className="mt-1 block w-full text-xs"
                  />
                </label>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stock</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted-foreground">
                  Quantity
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
                  Fulfilment block (optional)
                  {fulfilmentBlocks.length > 0 ? (
                    <select
                      value={addFulfilmentBlockId}
                      onChange={(e) => setAddFulfilmentBlockId(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    >
                      <option value="">— no block —</option>
                      {fulfilmentBlocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted-foreground/80 leading-relaxed">
                      Add fulfilment blocks below to group stock by suite / area.
                    </div>
                  )}
                </label>
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Note (optional)
                  <input
                    value={addNote}
                    onChange={(e) => setAddNote(e.target.value)}
                    placeholder="Batch reference, payment terms, etc."
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                </label>
              </div>
            </div>
            <div>
              <button
                type="button"
                disabled={pending}
                onClick={() => submitAdd()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Add stock purchase
              </button>
              <p className="text-[11px] text-muted-foreground mt-2">
                Creates the purchase order, adds stock at this buy price, and syncs supplier breakdown to
                Salesforce Stock Sources on the next product sync.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
