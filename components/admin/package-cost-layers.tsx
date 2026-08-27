"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  addStockPurchaseLayer,
  deleteCostLayer,
  listCrmCompanyOptions,
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
  linkedPoolAttributedPipeline,
  linkedPoolAttributedSold,
  linkedPoolSellableForPackage,
  packageClosedWonUnits,
  salesforceClosedWonSold,
  unsignedPipelinePlaces,
  type LinkedSellableMember,
} from "@/lib/admin/package-sales-breakdown"
import { resolveSoldByCostLayer, soldMapFromRecord } from "@/lib/inventory/sold-by-cost-layer"
import { packageDurationLabel } from "@/lib/catalog/package-duration"
import { SupplierNameLink } from "@/components/admin/profile-name-link"
import { CompanySupplierSelect } from "@/components/admin/company-supplier-select"
import type { CrmCompanyOption } from "@/lib/crm/deals"
import { formatMoney } from "@/lib/format/money"

type Props = {
  packageId: string
  packageCurrency: string
  packageName: string
  packageDuration?: string | null
  eventDate?: string | null
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
  /** Closed-won deal quantities assigned to each cost layer. */
  fulfilmentSoldByLayer?: Record<string, number>
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
  eventDate = null,
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
  fulfilmentSoldByLayer,
  onInventoryChanged,
}: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const addFileRef = useRef<HTMLInputElement | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addQty, setAddQty] = useState("")
  const [addCost, setAddCost] = useState("")
  const [addNote, setAddNote] = useState("")
  const [addSupplierAccountId, setAddSupplierAccountId] = useState("")
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
  const [editSupplierAccountId, setEditSupplierAccountId] = useState("")
  const [editPoNumber, setEditPoNumber] = useState("")
  const [editPoIssuedAt, setEditPoIssuedAt] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editQty, setEditQty] = useState("")
  const [editCascade, setEditCascade] = useState(true)
  const [editFulfilmentBlockId, setEditFulfilmentBlockId] = useState("")
  const [orphanEditing, setOrphanEditing] = useState(false)
  const [orphanQty, setOrphanQty] = useState("")
  const [orphanConvert, setOrphanConvert] = useState(false)
  const [orphanSupplierAccountId, setOrphanSupplierAccountId] = useState("")
  const [orphanCost, setOrphanCost] = useState("0")
  const [orphanNote, setOrphanNote] = useState("")
  const [orphanDate, setOrphanDate] = useState("")
  const [orphanPoNumber, setOrphanPoNumber] = useState("")
  const [orphanPoIssuedAt, setOrphanPoIssuedAt] = useState("")
  const [orphanBlockId, setOrphanBlockId] = useState("")

  const [companies, setCompanies] = useState<CrmCompanyOption[]>([])

  useEffect(() => {
    let cancelled = false
    void listCrmCompanyOptions().then((rows) => {
      if (!cancelled) setCompanies(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const duration = packageDuration?.trim() || null
  // Linked day packages always display the 3-day purchase ledger when the parent has layers
  // (even if this day imported its own SF Stock Source rows — those duplicates skew Sold/Left).
  const inheritsSharedLedger =
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

  const displayLayers =
    inheritsSharedLedger && sharedLedgerParent?.cost_layers?.length
      ? sharedLedgerParent.cost_layers
      : layers
  const isSharedLedgerView =
    inheritsSharedLedger && !!sharedLedgerParent && displayLayers.length > 0 && displayLayers !== layers

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

  const linkedMembers: LinkedSellableMember[] = useMemo(
    () =>
      linkedPackages.map((p) => ({
        id: p.id,
        duration: p.duration,
        breakdown: p.id === packageId ? salesBreakdown : p.sales_breakdown,
      })),
    [linkedPackages, packageId, salesBreakdown],
  )

  /**
   * Closed-won + portal/Wix sold on this package's Stock Purchased ledger.
   * Same figure as the Inventory Sold box: overlapping linked SKUs share the
   * 3-day purchase, so we use pool remaining (Sunday + 2-day), not the sum of
   * every Places Sold row.
   */
  const attributedLedgerSold = useMemo(() => {
    const ownSold = packageClosedWonUnits(salesBreakdown)
    if (linkedPackages.length <= 1) return ownSold
    return linkedPoolAttributedSold({
      stock: resolvedStockTotal,
      targetId: packageId,
      targetDuration: packageDuration ?? null,
      members: linkedMembers,
    })
  }, [
    salesBreakdown,
    linkedPackages.length,
    resolvedStockTotal,
    packageId,
    packageDuration,
    linkedMembers,
  ])

  /** Signed pipeline that reduces this package's Sellable — matches Left to Sellable. */
  const attributedLedgerPipeline = useMemo(() => {
    const ownOpen = Math.max(0, Math.floor(salesBreakdown.salesforceOpenPipeline))
    if (linkedPackages.length <= 1) return ownOpen
    return linkedPoolAttributedPipeline({
      stock: resolvedStockTotal,
      targetId: packageId,
      targetDuration: packageDuration ?? null,
      members: linkedMembers,
    })
  }, [
    salesBreakdown,
    linkedPackages.length,
    resolvedStockTotal,
    packageId,
    packageDuration,
    linkedMembers,
  ])

  const soldByLayerId = useMemo(() => {
    return resolveSoldByCostLayer({
      layers: displayLayers,
      fulfilmentSoldByLayer: soldMapFromRecord(fulfilmentSoldByLayer),
      totalPackageSold: attributedLedgerSold,
    })
  }, [displayLayers, attributedLedgerSold, fulfilmentSoldByLayer])

  /** Remaining after closed-won Sold and open SF pipeline (matches Sellable). */
  const leftByLayerId = useMemo(() => {
    const fifo = [...displayLayers].sort((a, b) => {
      const ta = a.received_at ? Date.parse(a.received_at) : 0
      const tb = b.received_at ? Date.parse(b.received_at) : 0
      if (ta !== tb) return ta - tb
      return a.id.localeCompare(b.id)
    })
    const left = new Map<string, number>()
    let pipelineLeft = Math.max(0, Math.floor(attributedLedgerPipeline))
    for (const layer of fifo) {
      const sold = Math.max(0, Math.floor(soldByLayerId.get(layer.id) ?? 0))
      const afterSold = Math.max(0, layer.quantity - sold)
      const hold = Math.min(afterSold, pipelineLeft)
      pipelineLeft -= hold
      left.set(layer.id, Math.max(0, afterSold - hold))
    }
    return left
  }, [displayLayers, soldByLayerId, attributedLedgerPipeline])

  const purchaseOrderById = useMemo(
    () => new Map(purchaseOrders.map((po) => [po.id, po])),
    [purchaseOrders],
  )
  const blockById = useMemo(
    () => new Map(fulfilmentBlocks.map((b) => [b.id, b])),
    [fulfilmentBlocks],
  )
  const { totalRemaining, totalCostBasis, weightedCost } = useMemo(() => {
    let units = 0
    let cost = 0
    for (const l of displayLayers) {
      const left = Math.max(0, Math.floor(leftByLayerId.get(l.id) ?? l.quantity_remaining))
      if (left > 0) {
        units += left
        cost += l.unit_cost * left
      }
    }
    return {
      totalRemaining: units,
      totalCostBasis: cost,
      weightedCost: units > 0 ? cost / units : null,
    }
  }, [displayLayers, leftByLayerId])

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
      return linkedPackages.map((p) => ({
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
    setAddSupplierAccountId("")
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
    if (!addSupplierAccountId) {
      toast.error("Select a company as the supplier — a purchase order is created automatically.")
      return
    }
    start(async () => {
      const fd = new FormData()
      fd.set("packageId", packageId)
      fd.set("quantity", String(q))
      fd.set("unitCost", String(c))
      fd.set("supplierAccountId", addSupplierAccountId)
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
    setEditSupplierAccountId(linkedPo?.supplier_account_id ?? "")
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
    if (!editSupplierAccountId) {
      toast.error("Select a company as the supplier.")
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
        purchaseOrderSupplierAccountId: editSupplierAccountId,
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
    setOrphanSupplierAccountId("")
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
      if (!orphanSupplierAccountId) {
        toast.error("Select a company as the supplier.")
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
              supplierAccountId: orphanSupplierAccountId,
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
              <th className="px-3 py-2 font-medium text-right">Website</th>
              <th className="px-3 py-2 font-medium text-right">Offline deals</th>
              <th className="px-3 py-2 font-medium text-right">Pipeline</th>
              <th className="px-3 py-2 font-medium text-right">Total sold</th>
              <th className="px-3 py-2 font-medium text-right">Sellable</th>
            </tr>
          </thead>
          <tbody>
            {packageSalesRows.map((row) => {
              const duration = packageDurationLabel(row.duration)
              const label = duration ? `${row.name} · ${duration}` : row.name
              const rowClass = row.isCurrent
                ? "border-t border-border bg-muted/15 font-medium text-foreground"
                : "border-t border-border text-muted-foreground"
              return (
                <tr key={row.id} className={rowClass}>
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(row.salesBreakdown.wix)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(salesforceClosedWonSold(row.salesBreakdown))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(unsignedPipelinePlaces(row.salesBreakdown))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {soldCount(
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
        <p className="text-[10px] text-muted-foreground">
          Pipeline is open deals before the booking form is signed. Those places stay visible
          here and do not reduce Sellable. Signed contracts hold stock even before payment.
        </p>
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
            supplier layers. Edit purchases on the 3-day package.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Sold is portal, website, and signed offline deals (including unpaid). Left follows
            those held units so it matches Sellable. Price sent and unsigned deals do not reduce
            Sellable — use a hold if the client asks you to keep stock.
          </p>
        )}
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
                      <CompanySupplierSelect
                        companies={companies}
                        value={orphanSupplierAccountId}
                        onChange={setOrphanSupplierAccountId}
                        disabled={pending}
                        className="px-2 py-1 rounded text-xs"
                      />
                      <input
                        value={orphanPoNumber}
                        onChange={(e) => setOrphanPoNumber(e.target.value)}
                        placeholder="Leave blank to auto-generate"
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
                const left = Math.max(
                  0,
                  Math.floor(leftByLayerId.get(layer.id) ?? layer.quantity - attributedSold),
                )
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
                          <CompanySupplierSelect
                            companies={companies}
                            value={editSupplierAccountId}
                            onChange={setEditSupplierAccountId}
                            typedName={
                              linkedPo?.supplier_account_id
                                ? null
                                : linkedPo?.supplier || layer.source || null
                            }
                            className="px-2 py-1 rounded text-xs"
                          />
                          <input
                            value={editPoNumber}
                            onChange={(e) => setEditPoNumber(e.target.value)}
                            placeholder="Leave blank to auto-generate"
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                          <input
                            type="date"
                            value={editPoIssuedAt}
                            onChange={(e) => setEditPoIssuedAt(e.target.value)}
                            className="w-full px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                          {layer.purchase_order_id ? (
                            <Link
                              href={`/admin/purchase-orders?po=${encodeURIComponent(layer.purchase_order_id)}`}
                              className="text-[10px] text-primary hover:underline w-fit"
                            >
                              Open purchase order
                            </Link>
                          ) : null}
                        </div>
                      ) : linkedPo || layer.purchase_order_id ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground">
                            <SupplierNameLink
                              supplierId={linkedPo?.supplier_id ?? layer.supplier_id}
                              name={linkedPo?.supplier || layer.source || "—"}
                            />
                          </span>
                          <Link
                            href={`/admin/purchase-orders?po=${encodeURIComponent(linkedPo?.id ?? layer.purchase_order_id ?? "")}`}
                            className="text-[10px] text-primary hover:underline w-fit"
                          >
                            {linkedPo?.po_number ? `PO ${linkedPo.po_number}` : "View purchase order"}
                          </Link>
                          {linkedPo?.issued_at ? (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDisplayDate(linkedPo.issued_at)}
                            </span>
                          ) : null}
                        </div>
                      ) : layer.source ? (
                        <SupplierNameLink supplierId={layer.supplier_id} name={layer.source} />
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
                          {attributedSold === 0 ? (
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
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Purchase order
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
                A purchase order number is generated automatically and linked here. Open it on Purchase
                orders to add the contract, invoice, and other details. Re-use an existing PO number
                only if this stock is from the same contract.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-muted-foreground sm:col-span-2">
                  Supplier
                  <div className="mt-1">
                    <CompanySupplierSelect
                      companies={companies}
                      value={addSupplierAccountId}
                      onChange={setAddSupplierAccountId}
                    />
                  </div>
                </label>
                <label className="block text-xs text-muted-foreground">
                  Existing PO number (optional)
                  <input
                    value={addPoNumber}
                    onChange={(e) => setAddPoNumber(e.target.value)}
                    placeholder="Leave blank to generate a new PO"
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
                Creates the purchase order and adds stock at this buy price.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
