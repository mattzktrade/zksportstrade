"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { toast } from "sonner"
import { updateOrderSupplierAllocations } from "@/app/(admin)/actions"
import { swapDealLineSuppliers } from "@/app/(admin)/admin/deals/deal-edit-actions"
import { cn } from "@/lib/utils"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import {
  DEAL_STAGE_LABELS,
  dealStageHoldsPurchasedStock,
  dealStageIsConfirmed,
  dealStageIsOpenPipeline,
  type PackageDealSaleRow,
} from "@/lib/crm/deal-types"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { formatMoney } from "@/lib/format/money"
import { adminDealPath, adminOrderDealPath } from "@/lib/admin/deal-link"
import { AccountNameLink, ContactNameLink } from "@/components/admin/profile-name-link"
import type { LinkedInventoryPackage } from "@/lib/admin/linked-inventory"
import { invoiceDisplayLabel, isOutstandingInvoiceStatus } from "@/lib/invoices/status"
import { costDaySlotsForDuration } from "@/lib/inventory/day-cost-allocation"
import {
  groupSupplierPoolOptions,
  type SupplierPoolOption,
} from "@/lib/inventory/supplier-pool"

const EMPTY_DEALS: PackageDealSaleRow[] = []

function inventoryDaySlot(value: string): string {
  return value.replace(/_only$/, "")
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function isPortalDealSource(source: string): boolean {
  return source === "portal" || source === "website"
}

function isPortalListedDeal(deal: PackageDealSaleRow): boolean {
  return Boolean(deal.orderId) || isPortalDealSource(deal.source)
}

function dealChannelLabel(deal: PackageDealSaleRow): string {
  return isPortalListedDeal(deal) ? "Portal" : "Offline deal"
}

function dealReferenceLabel(deal: PackageDealSaleRow): string {
  if (isPortalListedDeal(deal) && deal.orderReference?.trim()) {
    return deal.orderReference.trim()
  }
  return deal.reference
}

function orderPaymentLabel(order: AdminOrderListRow, deal: PackageDealSaleRow | null): string {
  if (deal) return DEAL_STAGE_LABELS[deal.stage] ?? deal.stage
  return invoiceDisplayLabel(order.invoice?.status)
}

function saleIsIncomplete(
  deal: PackageDealSaleRow | null,
  order?: AdminOrderListRow | null,
): boolean {
  if (order?.status === "cancelled") return false
  if (deal) return dealStageIsOpenPipeline(deal.stage)
  return isOutstandingInvoiceStatus(order?.invoice?.status)
}

function ownedAllocatedQuantity(deal: PackageDealSaleRow): number {
  return deal.lines
    .filter((line) => line.sourcingMode === "owned")
    .reduce((sum, line) => {
      const allocated = line.supplierAllocations.reduce(
        (quantity, allocation) => quantity + allocation.quantity,
        0,
      )
      return sum + allocated
    }, 0)
}

/** Offline signed deals, or portal deals whose purchased stock is already on the deal line. */
function dealProjectsSupplierConsumption(deal: PackageDealSaleRow): boolean {
  if (!dealStageHoldsPurchasedStock(deal.stage)) return false
  if (!deal.orderId) return true
  return ownedAllocatedQuantity(deal) > 0
}

function paymentTone(
  deal: PackageDealSaleRow | null,
  order?: AdminOrderListRow | null,
): "green" | "amber" | "red" | "blue" | "gray" {
  if (order?.status === "cancelled") return "gray"
  if (deal) {
    if (dealStageIsConfirmed(deal.stage)) return "green"
    if (deal.stage === "awaiting_payment") return "red"
    return "amber"
  }
  if (isOutstandingInvoiceStatus(order?.invoice?.status)) return "red"
  return "green"
}

function PaymentStatusCell({
  label,
  tone,
  incomplete,
}: {
  label: string
  tone: "green" | "amber" | "red" | "blue" | "gray"
  incomplete: boolean
}) {
  return (
    <td className="px-3 py-3">
      <div className="space-y-1">
        <StatusPill tone={tone}>{label}</StatusPill>
        {incomplete ? (
          <p className="text-[10px] font-semibold leading-snug text-amber-800 dark:text-amber-200">
            Not complete — do not fulfil
          </p>
        ) : null}
      </div>
    </td>
  )
}

function UnconfirmedSupplierNote({ portalOrder = false }: { portalOrder?: boolean }) {
  return (
    <p className="max-w-[220px] text-xs leading-snug text-amber-800 dark:text-amber-200">
      {portalOrder
        ? "This deal is not signed yet — do not fulfil. Supplier is assigned after the booking form is signed."
        : "Supplier is assigned once this deal is signed. It does not take purchased stock yet."}
    </p>
  )
}

function matchesSaleQuery(haystack: Array<string | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return haystack
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .includes(needle)
}

function orderMatchesSearch(
  order: AdminOrderListRow,
  deal: PackageDealSaleRow | null,
  query: string,
): boolean {
  return matchesSaleQuery(
    [
      order.reference,
      order.client_name,
      order.client_email,
      order.agent?.company_name,
      order.agent?.full_name,
      order.agent?.email,
      order.packages?.name,
      deal?.accountName,
      deal?.contactName,
      deal?.reference,
    ],
    query,
  )
}

function dealMatchesSearch(deal: PackageDealSaleRow, query: string): boolean {
  return matchesSaleQuery(
    [
      deal.reference,
      deal.orderReference,
      deal.accountName,
      deal.contactName,
      ...deal.lines.map((line) => line.packageName),
    ],
    query,
  )
}

function agentPrimary(agent: AdminOrderListRow["agent"]): string {
  if (!agent) return "—"
  return (agent.company_name?.trim() || agent.full_name?.trim() || agent.email || "—").toString()
}

function layerSupplierLabel(layer: CostLayerRow): string {
  const source = layer.source?.trim() || "Unassigned"
  const remaining = Math.max(0, Math.floor(Number(layer.quantity_remaining)))
  return `${source} (${remaining} left, ${formatMoney(layer.currency, Number(layer.unit_cost))})`
}

function supplierPoolLabel(option: SupplierPoolOption, projectedBalance: number): string {
  const balance =
    projectedBalance > 0
      ? `+${projectedBalance} left`
      : projectedBalance === 0
        ? "0 balanced"
        : `${projectedBalance} over`
  return `${option.name} — ${balance}`
}

type DraftAllocation = { costLayerId: string; quantity: string }

function SupplierAllocationEditor({
  order,
  costLayers,
}: {
  order: AdminOrderListRow
  costLayers: CostLayerRow[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const initial = useMemo<DraftAllocation[]>(() => {
    const fromConsumptions = order.supplierConsumptions
      .filter((c) => c.costLayerId)
      .map((c) => ({ costLayerId: c.costLayerId ?? "", quantity: String(c.quantity) }))
    if (fromConsumptions.length > 0) {
      return fromConsumptions.map((row) => {
        if (costLayers.some((l) => l.id === row.costLayerId)) return row
        const cons = order.supplierConsumptions.find((c) => c.costLayerId === row.costLayerId)
        const supplier = (cons?.supplier ?? "").trim().toLowerCase()
        if (!supplier) return row
        const match = costLayers.find((l) => (l.source?.trim() || "").toLowerCase() === supplier)
        return match ? { ...row, costLayerId: match.id } : row
      })
    }
    if (order.supplierAllocations.length > 0) {
      return order.supplierAllocations.map((a) => {
        const supplier = a.supplier.trim().toLowerCase()
        const match = costLayers.find((l) => (l.source?.trim() || "").toLowerCase() === supplier)
        return {
          costLayerId: match?.id ?? "",
          quantity: String(a.quantity),
        }
      })
    }
    return [{ costLayerId: "", quantity: String(order.guests) }]
  }, [order.guests, order.supplierConsumptions, order.supplierAllocations, costLayers])
  const [rows, setRows] = useState<DraftAllocation[]>(initial)
  useEffect(() => {
    setRows(initial)
  }, [initial])

  const currentSummary =
    order.supplierAllocations.length > 0
      ? order.supplierAllocations.map((a) => `${a.quantity}x ${a.supplier}`).join(" · ")
      : "Unassigned"

  function updateRow(index: number, patch: Partial<DraftAllocation>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function save() {
    const allocations = rows.map((row) => ({
      costLayerId: row.costLayerId,
      quantity: Math.floor(Number(row.quantity)),
    }))
    const total = allocations.reduce((sum, a) => sum + (Number.isFinite(a.quantity) ? a.quantity : 0), 0)
    if (total !== order.guests) {
      toast.error(`Supplier quantities must add up to ${order.guests}.`)
      return
    }
    if (allocations.some((a) => !a.costLayerId || !Number.isFinite(a.quantity) || a.quantity <= 0)) {
      toast.error("Choose a supplier and positive quantity for every row.")
      return
    }

    start(async () => {
      const res = await updateOrderSupplierAllocations({
        orderId: order.id,
        packageId: order.package_id,
        allocations,
      })
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success("Supplier allocation updated.")
      router.refresh()
    })
  }

  return (
    <div className="min-w-[220px] max-w-[280px] space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">{currentSummary}</p>
      {order.status === "cancelled" ? null : (
        <div className="space-y-1.5">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <select
                value={row.costLayerId}
                onChange={(e) => updateRow(index, { costLayerId: e.target.value })}
                disabled={pending}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="">Choose supplier...</option>
                {costLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layerSupplierLabel(layer)}
                  </option>
                ))}
              </select>
              <input
                inputMode="numeric"
                value={row.quantity}
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
                disabled={pending}
                className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right text-xs"
              />
              {rows.length > 1 ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                  className="text-xs text-destructive hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => setRows((current) => [...current, { costLayerId: "", quantity: "" }])}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              Split supplier
            </button>
            <button
              type="button"
              disabled={pending || costLayers.length === 0}
              onClick={save}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function DealSupplierEditor({
  deal,
  supplierPools,
  projectedBalances,
  drafts,
  pending,
  onChange,
}: {
  deal: PackageDealSaleRow
  supplierPools: SupplierPoolOption[]
  projectedBalances: Record<string, number>
  drafts: Record<string, string>
  pending: boolean
  onChange: (lineId: string, supplierKey: string) => void
}) {
  const ownedLines = deal.lines.filter((line) => line.sourcingMode === "owned")
  const brokeredLines = deal.lines.filter((line) => line.sourcingMode === "brokered")
  const selectedKeys = [
    ...new Set(
      ownedLines
        .map((line) => drafts[line.id] ?? line.supplierKey)
        .filter((key) => Boolean(key)),
    ),
  ]
  const commonKey = selectedKeys.length === 1 ? selectedKeys[0] : ""
  const splitAcrossSuppliers = ownedLines.length > 1 && selectedKeys.length !== 1

  return (
    <div className="min-w-[190px] space-y-1.5">
      {brokeredLines.map((line) => (
        <p key={line.id}>{line.supplierName || "Brokered supplier"}</p>
      ))}
      {ownedLines.length > 0 ? (
        <select
          value={commonKey}
          disabled={pending || supplierPools.length === 0}
          onChange={(event) => {
            for (const line of ownedLines) onChange(line.id, event.target.value)
          }}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          {splitAcrossSuppliers || !commonKey ? (
            <option value="">
              {splitAcrossSuppliers
                ? `Split across ${Math.max(selectedKeys.length, 2)} suppliers — choose one`
                : ownedLines[0]?.supplierName || "Choose supplier…"}
            </option>
          ) : null}
          {supplierPools.map((supplier) => (
            <option key={supplier.key} value={supplier.key}>
              {supplierPoolLabel(
                supplier,
                projectedBalances[supplier.key] ?? supplier.targetCapacity,
              )}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

export function PackageOrdersTable({
  orders,
  deals = EMPTY_DEALS,
  costLayers,
  purchaseOrders = [],
  linkedPackages = [],
  currentPackageDuration = null,
  eventDate = null,
}: {
  orders: AdminOrderListRow[]
  deals?: PackageDealSaleRow[]
  costLayers: CostLayerRow[]
  purchaseOrders?: PurchaseOrderRow[]
  linkedPackages?: LinkedInventoryPackage[]
  currentPackageDuration?: string | null
  eventDate?: string | null
}) {
  const router = useRouter()
  const usesLinkedDaySlots = linkedPackages.length > 1
  const targetSlots = usesLinkedDaySlots
    ? costDaySlotsForDuration(currentPackageDuration, eventDate).map(inventoryDaySlot)
    : ["unit"]
  const durationByPackageId = new Map(
    linkedPackages.map((pkg) => [pkg.id, pkg.duration]),
  )
  const supplierPools = useMemo(
    () => groupSupplierPoolOptions(costLayers, purchaseOrders, targetSlots),
    [costLayers, purchaseOrders, targetSlots],
  )
  const currentAssignments = useMemo(
    () =>
      Object.fromEntries(
        deals.flatMap((deal) =>
          dealProjectsSupplierConsumption(deal)
            ? deal.lines
                .filter((line) => line.sourcingMode === "owned")
                .map((line) => [line.id, line.supplierKey])
            : [],
        ),
      ),
    [deals],
  )
  const dealByOrderId = useMemo(() => {
    const map = new Map<string, PackageDealSaleRow>()
    for (const deal of deals) {
      if (deal.orderId) map.set(deal.orderId, deal)
    }
    return map
  }, [deals])
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals])
  const [supplierDrafts, setSupplierDrafts] =
    useState<Record<string, string>>(currentAssignments)
  const [supplierPending, startSupplierSave] = useTransition()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saleFilter, setSaleFilter] = useState<"all" | "confirmed" | "incomplete">("all")
  const [saleQuery, setSaleQuery] = useState("")

  useEffect(() => {
    setSupplierDrafts(currentAssignments)
  }, [currentAssignments])

  const changedSupplierAssignments = deals.flatMap((deal) =>
    dealProjectsSupplierConsumption(deal)
      ? deal.lines
          .filter(
            (line) =>
              line.sourcingMode === "owned" &&
              supplierDrafts[line.id] &&
              supplierDrafts[line.id] !== line.supplierKey,
          )
          .map((line) => ({
            lineId: line.id,
            supplierKey: supplierDrafts[line.id],
          }))
      : [],
  )
  const projectedConsumption = new Map(
    supplierPools.map((supplier) => [supplier.key, new Map<string, number>()]),
  )
  const supplierKeyByName = new Map(
    supplierPools.map((supplier) => [supplier.name.trim().toLowerCase(), supplier.key]),
  )
  const addProjectedConsumption = (
    supplierKey: string,
    packageDuration: string | null | undefined,
    quantity: number,
  ) => {
    const consumption = projectedConsumption.get(supplierKey)
    if (!consumption) return false
    const slots = usesLinkedDaySlots
      ? costDaySlotsForDuration(packageDuration, eventDate).map(inventoryDaySlot)
      : ["unit"]
    for (const slot of slots.length > 0 ? slots : targetSlots) {
      consumption.set(slot, (consumption.get(slot) ?? 0) + quantity)
    }
    return true
  }
  let projectedUnassigned = 0
  for (const deal of deals) {
    if (!dealProjectsSupplierConsumption(deal)) continue
    for (const line of deal.lines) {
      if (line.sourcingMode !== "owned") continue
      const packageDuration = durationByPackageId.get(line.packageId)
      const draftedSupplierKey = supplierDrafts[line.id] ?? line.supplierKey
      if (draftedSupplierKey) {
        if (!addProjectedConsumption(draftedSupplierKey, packageDuration, line.quantity)) {
          projectedUnassigned += line.quantity
        }
        continue
      }
      let allocatedQuantity = 0
      for (const allocation of line.supplierAllocations) {
        if (!addProjectedConsumption(allocation.key, packageDuration, allocation.quantity)) continue
        allocatedQuantity += allocation.quantity
      }
      projectedUnassigned += Math.max(0, line.quantity - allocatedQuantity)
    }
  }
  for (const order of orders) {
    if (order.status === "cancelled") continue
    const linkedDeal = dealByOrderId.get(order.id)
    if (linkedDeal && dealProjectsSupplierConsumption(linkedDeal)) continue
    const packageDuration =
      durationByPackageId.get(order.package_id) ?? order.packages?.duration
    for (const allocation of order.supplierAllocations) {
      const supplierKey = supplierKeyByName.get(allocation.supplier.trim().toLowerCase())
      if (
        !supplierKey ||
        !addProjectedConsumption(supplierKey, packageDuration, allocation.quantity)
      ) {
        projectedUnassigned += allocation.quantity
        continue
      }
    }
  }
  const projectedAssigned = new Map(
    supplierPools.map((supplier) => {
      const consumption = projectedConsumption.get(supplier.key)
      return [
        supplier.key,
        Math.max(...targetSlots.map((slot) => consumption?.get(slot) ?? 0), 0),
      ]
    }),
  )
  const projectedBalances = Object.fromEntries(
    supplierPools.map((supplier) => [
      supplier.key,
      supplier.targetCapacity - (projectedAssigned.get(supplier.key) ?? 0),
    ]),
  )
  const hasProjectedShortage = Object.values(projectedBalances).some(
    (balance) => balance < 0,
  )
  const supplierChangesBalanced =
    projectedUnassigned === 0 && !hasProjectedShortage

  function saveSupplierChanges() {
    if (changedSupplierAssignments.length === 0 || !supplierChangesBalanced) return
    startSupplierSave(async () => {
      const result = await swapDealLineSuppliers({
        assignments: changedSupplierAssignments,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  if (orders.length === 0 && deals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No orders or offline deals recorded for this package yet.
      </p>
    )
  }

  const sorted = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const linkedDealIds = new Set<string>()
  for (const order of orders) {
    const linked = dealByOrderId.get(order.id) ?? (order.deal_id ? dealById.get(order.deal_id) : undefined)
    if (linked) linkedDealIds.add(linked.id)
  }
  const offlineDeals = deals.filter((deal) => !linkedDealIds.has(deal.id))
  const sortedDeals = [...offlineDeals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const linkedDealForOrder = (order: AdminOrderListRow) =>
    dealByOrderId.get(order.id) ?? (order.deal_id ? dealById.get(order.deal_id) ?? null : null)
  const visibleOrders = sorted.filter((order) => {
    const linkedDeal = linkedDealForOrder(order)
    const incomplete = saleIsIncomplete(linkedDeal, order)
    if (saleFilter === "incomplete" && !incomplete) return false
    if (saleFilter === "confirmed" && incomplete) return false
    return orderMatchesSearch(order, linkedDeal, saleQuery)
  })
  const visibleDeals = sortedDeals.filter((deal) => {
    const incomplete = saleIsIncomplete(deal)
    if (saleFilter === "incomplete" && !incomplete) return false
    if (saleFilter === "confirmed" && incomplete) return false
    return dealMatchesSearch(deal, saleQuery)
  })
  const incompleteRowCount =
    sorted.filter((order) => saleIsIncomplete(linkedDealForOrder(order), order)).length +
    sortedDeals.filter((deal) => saleIsIncomplete(deal)).length

  let totalRevenue = 0
  let totalCogs = 0
  let totalProfit = 0
  let pricedCount = 0
  for (const o of sorted) {
    if (o.status === "cancelled") continue
    totalRevenue += Number(o.total_amount)
    if (o.profit.cost_known && o.profit.cogs != null && o.profit.gross_profit != null) {
      totalCogs += o.profit.cogs
      totalProfit += o.profit.gross_profit
      pricedCount += 1
    }
  }
  for (const deal of sortedDeals) {
    totalRevenue += deal.totalAmount
    const cogs = deal.cogs
    if (cogs != null) {
      totalCogs += cogs
      totalProfit += deal.totalAmount - cogs
      pricedCount += 1
    }
  }
  const cur = (sorted[0]?.currency || sortedDeals[0]?.currency || "USD").trim() || "USD"
  const liveOrderCount = sorted.filter((order) => order.status !== "cancelled").length
  const saleCount = liveOrderCount + sortedDeals.length
  const portalDealCount = sortedDeals.filter((deal) => isPortalDealSource(deal.source)).length
  const offlineDealCount = sortedDeals.length - portalDealCount
  const portalCount = liveOrderCount + portalDealCount
  const saleSummaryParts: string[] = []
  if (portalCount > 0) {
    saleSummaryParts.push(`${portalCount} portal/website order${portalCount === 1 ? "" : "s"}`)
  }
  if (offlineDealCount > 0) {
    saleSummaryParts.push(`${offlineDealCount} offline deal${offlineDealCount === 1 ? "" : "s"}`)
  }
  const saleSummary = saleSummaryParts.join(" and ")

  return (
    <div className="space-y-4 min-w-0">
      {pricedCount > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Revenue</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(cur, totalRevenue)}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">COGS</p>
            <p className="text-lg font-semibold tabular-nums">{formatMoney(cur, totalCogs)}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gross profit</p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                totalProfit >= 0 ? "text-emerald-600" : "text-destructive",
              )}
            >
              {formatMoney(cur, totalProfit)}
            </p>
            {totalRevenue > 0 && saleCount > 0 && pricedCount === saleCount ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatPct(totalProfit / totalRevenue)} margin
              </p>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {saleSummary ? `${saleSummary} for this package. ` : null}
        <Link href="/admin/orders" className="text-primary hover:underline">
          View all orders
        </Link>
        {" · "}
        <Link href="/admin/deals" className="text-primary hover:underline">
          View all deals
        </Link>
      </p>
      {incompleteRowCount > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {incompleteRowCount} unsigned or unpaid
          {incompleteRowCount === 1 ? " row is" : " rows are"} highlighted. Unsigned deals do not take
          purchased stock. Signed deals hold stock and can have a supplier assigned, but should not
          be fulfilled until paid.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={saleQuery}
            onChange={(event) => setSaleQuery(event.target.value)}
            placeholder="Search company, contact or reference…"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40"
          />
        </div>
        {(
          [
            ["all", "Show all"],
            ["confirmed", "Paid / confirmed"],
            ["incomplete", "Not complete"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSaleFilter(id)}
            className={cn(
              "h-8 rounded-md border px-2.5 text-xs font-medium",
              saleFilter === id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {deals.some((deal) => dealStageHoldsPurchasedStock(deal.stage)) ? (
        <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Assign who should fulfil each signed order. Unsigned deals are listed for context
              and do not use purchased stock. Unpaid signed orders still show Awaiting payment and
              should not be fulfilled until paid. Balances update before anything is saved.
            </p>
            <button
              type="button"
              disabled={
                supplierPending ||
                changedSupplierAssignments.length === 0 ||
                !supplierChangesBalanced
              }
              onClick={saveSupplierChanges}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {supplierPending
                ? "Saving…"
                : `Save supplier change${changedSupplierAssignments.length === 1 ? "" : "s"}`}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {supplierPools.map((supplier) => {
              const assigned = projectedAssigned.get(supplier.key) ?? 0
              const balance = projectedBalances[supplier.key] ?? supplier.targetCapacity
              return (
                <div
                  key={supplier.key}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs",
                    balance < 0
                      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                      : balance > 0
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                        : "border-border bg-background text-foreground",
                  )}
                >
                  <span className="font-medium">{supplier.name}</span>
                  <span className="ml-1.5 tabular-nums">
                    {supplier.purchased} bought · {assigned} assigned ·{" "}
                    {balance > 0 ? `+${balance} left` : balance === 0 ? "balanced" : `${balance} over`}
                  </span>
                </div>
              )
            })}
            {projectedUnassigned > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                {projectedUnassigned} paid place{projectedUnassigned === 1 ? "" : "s"} still unassigned
              </div>
            ) : null}
          </div>
          {!supplierChangesBalanced ? (
            <p className="text-xs text-muted-foreground">
              Resolve every red or unassigned balance before saving.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <AdminDesktopTable>
        <table className="w-full text-xs xl:text-sm min-w-[1120px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-3 font-medium">Reference</th>
              <th className="px-3 py-3 font-medium">Channel</th>
              <th className="px-3 py-3 font-medium">Agent / account</th>
              <th className="px-3 py-3 font-medium text-right">Guests</th>
              <th className="px-3 py-3 font-medium text-right">Total</th>
              <th className="px-3 py-3 font-medium text-right">COGS</th>
              <th className="px-3 py-3 font-medium text-right">Gross profit</th>
              <th className="px-3 py-3 font-medium text-right">Margin</th>
              <th className="px-3 py-3 font-medium">Supplier</th>
              <th className="px-3 py-3 font-medium min-w-[160px]">Payment</th>
              <th className="px-3 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleOrders.length === 0 && visibleDeals.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {saleQuery.trim()
                    ? "No orders match that search."
                    : saleFilter === "incomplete"
                      ? "No unconfirmed rows in this view."
                      : saleFilter === "confirmed"
                        ? "No paid or confirmed rows in this view."
                        : "No orders in this view."}
                </td>
              </tr>
            ) : null}
            {visibleOrders.map((o) => {
              const linkedDeal =
                dealByOrderId.get(o.id) ?? (o.deal_id ? dealById.get(o.deal_id) ?? null : null)
              const rowId = `order:${o.id}`
              const canExpand = !linkedDeal && !adminOrderDealPath(o.deal_id)
              const expanded = canExpand && expandedId === rowId
              return (
                <OrderSaleRows
                  key={o.id}
                  order={o}
                  deal={linkedDeal}
                  expanded={expanded}
                  onToggle={() => {
                    if (!canExpand) return
                    setExpandedId(expanded ? null : rowId)
                  }}
                  costLayers={costLayers}
                  supplierPools={supplierPools}
                  projectedBalances={projectedBalances}
                  supplierDrafts={supplierDrafts}
                  supplierPending={supplierPending}
                  onSupplierChange={(lineId, supplierKey) =>
                    setSupplierDrafts((current) => ({ ...current, [lineId]: supplierKey }))
                  }
                />
              )
            })}
            {visibleDeals.map((deal) => (
              <DealSaleRows
                key={deal.id}
                deal={deal}
                supplierPools={supplierPools}
                projectedBalances={projectedBalances}
                supplierDrafts={supplierDrafts}
                supplierPending={supplierPending}
                onSupplierChange={(lineId, supplierKey) =>
                  setSupplierDrafts((current) => ({ ...current, [lineId]: supplierKey }))
                }
              />
            ))}
          </tbody>
        </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {visibleOrders.map((o) => {
            const href = adminOrderDealPath(o.deal_id)
            const linkedDeal =
              dealByOrderId.get(o.id) ?? (o.deal_id ? dealById.get(o.deal_id) ?? null : null)
            const incomplete = saleIsIncomplete(linkedDeal, o)
            const body = (
              <>
                <div className="min-w-0">
                  <p className={cn("font-mono text-xs font-semibold", href && "text-primary")}>{o.reference}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{o.agent?.company_name || o.agent?.full_name || o.agent?.email || "Portal order"}</p>
                  {incomplete ? (
                    <p className="mt-1 text-[10px] font-semibold text-amber-800">Not complete — do not fulfil</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs font-semibold">{formatMoney(o.currency, Number(o.total_amount))}</p>
              </>
            )
            if (href) {
              return (
                <Link
                  key={o.id}
                  href={href}
                  className={cn(
                    "flex items-start justify-between gap-3 px-4 py-3",
                    incomplete && "bg-amber-50/90 dark:bg-amber-950/20",
                  )}
                >
                  {body}
                </Link>
              )
            }
            return (
              <div
                key={o.id}
                className={cn(
                  "flex items-start justify-between gap-3 px-4 py-3",
                  incomplete && "bg-amber-50/90 dark:bg-amber-950/20",
                )}
              >
                {body}
              </div>
            )
          })}
          {visibleDeals.map((deal) => {
            const incomplete = saleIsIncomplete(deal)
            return (
            <Link
              key={deal.id}
              href={adminDealPath(deal.id)}
              className={cn(
                "flex items-start justify-between gap-3 px-4 py-3",
                incomplete && "bg-amber-50/90 dark:bg-amber-950/20",
              )}
            >
              <div className="min-w-0">
                <p className="font-semibold text-primary">{dealReferenceLabel(deal)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {dealChannelLabel(deal)}
                  {deal.accountName ? ` · ${deal.accountName}` : ""}
                </p>
                {incomplete ? (
                  <p className="mt-1 text-[10px] font-semibold text-amber-800">Not complete — do not fulfil</p>
                ) : null}
              </div>
              <StatusPill tone={paymentTone(deal)}>{DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}</StatusPill>
            </Link>
            )
          })}
        </AdminMobileList>
      </div>
    </div>
  )
}

function MoneyCell({
  value,
  currency,
  emphasize = false,
}: {
  value: number | null
  currency: string
  emphasize?: boolean
}) {
  if (value == null) return <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">—</td>
  return (
    <td
      className={cn(
        "px-3 py-3 text-right tabular-nums",
        emphasize ? (value >= 0 ? "font-medium text-emerald-600" : "font-medium text-destructive") : "text-muted-foreground",
      )}
    >
      {formatMoney(currency, value)}
    </td>
  )
}

function OrderSaleRows({
  order,
  deal,
  expanded,
  onToggle,
  costLayers,
  supplierPools,
  projectedBalances,
  supplierDrafts,
  supplierPending,
  onSupplierChange,
}: {
  order: AdminOrderListRow
  deal: PackageDealSaleRow | null
  expanded: boolean
  onToggle: () => void
  costLayers: CostLayerRow[]
  supplierPools: SupplierPoolOption[]
  projectedBalances: Record<string, number>
  supplierDrafts: Record<string, string>
  supplierPending: boolean
  onSupplierChange: (lineId: string, supplierKey: string) => void
}) {
  const cogs = order.profit.cost_known ? order.profit.cogs : null
  const profit = order.profit.cost_known ? order.profit.gross_profit : null
  const dealHref = adminOrderDealPath(order.deal_id) ?? (deal ? adminDealPath(deal.id) : null)
  const incomplete = saleIsIncomplete(deal, order)
  const canAssignDealSupplier = Boolean(deal && dealProjectsSupplierConsumption(deal))
  return (
    <>
      <tr
        className={cn(
          "hover:bg-muted/30",
          expanded && "bg-muted/20",
          incomplete && "border-l-4 border-l-amber-400 bg-amber-50/80 dark:bg-amber-950/20",
        )}
      >
        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
          {dealHref ? (
            <Link href={dealHref} className="text-primary hover:underline">
              {order.reference}
            </Link>
          ) : (
            <button type="button" onClick={onToggle} className="text-primary hover:underline">
              {order.reference}
            </button>
          )}
        </td>
        <td className="px-3 py-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Portal</span>
          {order.packages?.name ? (
            <span className="mt-0.5 block max-w-[180px] normal-case leading-snug tracking-normal text-foreground">
              {order.packages.name}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-3">
          <p className="font-medium text-foreground">{agentPrimary(order.agent)}</p>
          {order.agent?.email ? <p className="text-xs text-muted-foreground">{order.agent.email}</p> : null}
        </td>
        <td className="px-3 py-3 text-right tabular-nums">{order.guests}</td>
        <td className="px-3 py-3 text-right tabular-nums font-medium">
          {formatMoney(order.currency, Number(order.total_amount))}
        </td>
        <MoneyCell value={cogs} currency={order.profit.currency || order.currency} />
        <MoneyCell value={profit} currency={order.profit.currency || order.currency} emphasize />
        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
          {order.profit.margin != null ? formatPct(order.profit.margin) : "—"}
        </td>
        <td className="px-3 py-3 text-muted-foreground">
          {canAssignDealSupplier && deal ? (
            <DealSupplierEditor
              deal={deal}
              supplierPools={supplierPools}
              projectedBalances={projectedBalances}
              drafts={supplierDrafts}
              pending={supplierPending}
              onChange={onSupplierChange}
            />
          ) : deal ? (
            <UnconfirmedSupplierNote portalOrder />
          ) : (
            <SupplierAllocationEditor order={order} costLayers={costLayers} />
          )}
        </td>
        <PaymentStatusCell
          label={orderPaymentLabel(order, deal)}
          tone={paymentTone(deal, order)}
          incomplete={incomplete}
        />
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatWhen(order.created_at)}
        </td>
      </tr>
      {!dealHref && expanded ? (
        <tr className="bg-muted/20">
          <td colSpan={11} className="px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-xs">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium">{order.client_name || "—"}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{order.client_email || "—"}</dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{order.client_phone || "—"}</dd>
                <dt className="text-muted-foreground">Guests</dt>
                <dd>{order.guests}</dd>
                <dt className="text-muted-foreground">Special requests</dt>
                <dd>{order.special_requests || "—"}</dd>
                <dt className="text-muted-foreground">Dietary</dt>
                <dd>{order.dietary_requirements || "—"}</dd>
                <dt className="text-muted-foreground">PO number</dt>
                <dd>{order.po_number || "—"}</dd>
              </dl>
              <Link href="/admin/orders" className="text-xs font-medium text-primary hover:underline">
                Open in orders
              </Link>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function DealSaleRows({
  deal,
  supplierPools,
  projectedBalances,
  supplierDrafts,
  supplierPending,
  onSupplierChange,
}: {
  deal: PackageDealSaleRow
  supplierPools: SupplierPoolOption[]
  projectedBalances: Record<string, number>
  supplierDrafts: Record<string, string>
  supplierPending: boolean
  onSupplierChange: (lineId: string, supplierKey: string) => void
}) {
  const cogs = deal.cogs
  const profit = cogs == null ? deal.grossProfit : deal.totalAmount - cogs
  const margin = profit == null || deal.totalAmount <= 0 ? deal.margin : profit / deal.totalAmount
  const incomplete = saleIsIncomplete(deal)
  const canAssignDealSupplier = dealStageHoldsPurchasedStock(deal.stage)
  return (
      <tr
        className={cn(
          "hover:bg-muted/30",
          incomplete && "border-l-4 border-l-amber-400 bg-amber-50/80 dark:bg-amber-950/20",
        )}
      >
        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
          <Link href={adminDealPath(deal.id)} className="text-primary hover:underline">
            {dealReferenceLabel(deal)}
          </Link>
        </td>
        <td className="px-3 py-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{dealChannelLabel(deal)}</span>
          <span className="mt-0.5 block max-w-[180px] normal-case leading-snug tracking-normal text-foreground">
            {[
              ...new Set(
                deal.lines
                  .map((line) => line.packageName?.trim())
                  .filter((name): name is string => !!name),
              ),
            ].join(" · ")}
          </span>
        </td>
        <td className="px-3 py-3">
          <AccountNameLink accountId={deal.accountId} name={deal.accountName || deal.contactName || "—"} className="font-medium text-foreground" />
          {deal.accountName && deal.contactName ? (
            <ContactNameLink accountId={deal.accountId} contactId={deal.contactId} name={deal.contactName} className="block text-xs text-muted-foreground" />
          ) : null}
        </td>
        <td className="px-3 py-3 text-right tabular-nums">{deal.quantity}</td>
        <td className="px-3 py-3 text-right tabular-nums font-medium">
          {formatMoney(deal.currency, deal.totalAmount)}
        </td>
        <MoneyCell value={cogs} currency={deal.currency} />
        <MoneyCell value={profit} currency={deal.currency} emphasize />
        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
          {margin != null ? formatPct(margin) : "—"}
        </td>
        <td className="px-3 py-3 text-muted-foreground">
          {canAssignDealSupplier ? (
            <DealSupplierEditor
              deal={deal}
              supplierPools={supplierPools}
              projectedBalances={projectedBalances}
              drafts={supplierDrafts}
              pending={supplierPending}
              onChange={onSupplierChange}
            />
          ) : (
            <UnconfirmedSupplierNote />
          )}
        </td>
        <PaymentStatusCell
          label={DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}
          tone={paymentTone(deal)}
          incomplete={incomplete}
        />
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatWhen(deal.createdAt)}
        </td>
      </tr>
  )
}
