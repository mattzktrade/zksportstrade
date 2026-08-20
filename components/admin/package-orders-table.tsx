"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateOrderSupplierAllocations } from "@/app/(admin)/actions"
import { cn } from "@/lib/utils"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { PurchaseOrderRow } from "@/lib/admin/purchase-orders"
import { DEAL_STAGE_LABELS, type PackageDealSaleRow } from "@/lib/crm/deal-types"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { AdminDesktopTable, AdminMobileList } from "@/components/admin/admin-page-kit"
import { formatMoney } from "@/lib/format/money"
import { adminDealPath } from "@/lib/admin/deal-link"
import { AccountNameLink, ContactNameLink, SupplierNameLink } from "@/components/admin/profile-name-link"
import {
  allocatePartyPreferSingleSupplier,
  cogsFromTakes,
  summarizeSupplierTakes,
  type AllocatableSupplierLayer,
  type SupplierAllocationTake,
} from "@/lib/inventory/single-supplier-allocate"

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
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

function orderSupplierLabel(order: AdminOrderListRow): string {
  if (order.supplierAllocations.length > 0) {
    return order.supplierAllocations.map((a) => `${a.quantity}x ${a.supplier}`).join(" · ")
  }
  return "Unassigned"
}

function layerToAllocatable(
  layer: CostLayerRow,
  purchaseOrders: ReadonlyMap<string, PurchaseOrderRow>,
  booked: number,
): AllocatableSupplierLayer {
  const po = layer.purchase_order_id ? purchaseOrders.get(layer.purchase_order_id) : null
  return {
    id: layer.id,
    available: Math.max(0, Math.floor(layer.quantity) - Math.max(0, booked)),
    unit_cost: layer.unit_cost,
    currency: layer.currency,
    source: layer.source,
    purchase_order_id: layer.purchase_order_id,
    fulfilment_block_id: layer.fulfilment_block_id,
    received_at: layer.received_at,
    supplier: po?.supplier?.trim() || layer.source?.trim() || "Unassigned",
  }
}

export function PackageOrdersTable({
  orders,
  deals = [],
  costLayers,
  purchaseOrders = [],
}: {
  orders: AdminOrderListRow[]
  deals?: PackageDealSaleRow[]
  costLayers: CostLayerRow[]
  purchaseOrders?: PurchaseOrderRow[]
}) {
  if (orders.length === 0 && deals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No orders or offline deals recorded for this package yet.
      </p>
    )
  }

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const purchaseOrderById = useMemo(
    () => new Map(purchaseOrders.map((po) => [po.id, po])),
    [purchaseOrders],
  )
  const dealFulfillment = useMemo(() => {
    const bookedByLayer = new Map<string, number>()
    for (const order of orders) {
      if (order.status === "cancelled") continue
      for (const consumption of order.supplierConsumptions) {
        if (!consumption.costLayerId) continue
        bookedByLayer.set(
          consumption.costLayerId,
          (bookedByLayer.get(consumption.costLayerId) ?? 0) + consumption.quantity,
        )
      }
    }
    const layers = costLayers.map((layer) =>
      layerToAllocatable(layer, purchaseOrderById, bookedByLayer.get(layer.id) ?? 0),
    )
    const takesByDeal = new Map<string, SupplierAllocationTake[]>()
    for (const deal of [...deals].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )) {
      if (deal.supplierLabel) continue
      takesByDeal.set(deal.id, allocatePartyPreferSingleSupplier(layers, deal.quantity))
    }
    return takesByDeal
  }, [costLayers, deals, orders, purchaseOrderById])

  const sorted = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const sortedDeals = [...deals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

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
    const attributed = dealFulfillment.get(deal.id) ?? []
    const cogs = deal.cogs ?? cogsFromTakes(attributed)
    if (cogs != null) {
      totalCogs += cogs
      totalProfit += deal.totalAmount - cogs
      pricedCount += 1
    }
  }
  const cur = (sorted[0]?.currency || sortedDeals[0]?.currency || "USD").trim() || "USD"

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
            {totalRevenue > 0 && pricedCount === sorted.filter((o) => o.status !== "cancelled").length ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatPct(totalProfit / totalRevenue)} margin
              </p>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {sorted.length} portal/website order{sorted.length === 1 ? "" : "s"}
        {sortedDeals.length > 0
          ? ` and ${sortedDeals.length} offline deal${sortedDeals.length === 1 ? "" : "s"}`
          : ""}{" "}
        for this package.{" "}
        <Link href="/admin/orders" className="text-primary hover:underline">
          View all orders
        </Link>
        {" · "}
        <Link href="/admin/deals" className="text-primary hover:underline">
          View all deals
        </Link>
      </p>

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
            {sorted.map((o) => {
              const rowId = `order:${o.id}`
              const expanded = expandedId === rowId
              return (
                <OrderSaleRows
                  key={o.id}
                  order={o}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : rowId)}
                  costLayers={costLayers}
                />
              )
            })}
            {sortedDeals.map((deal) => (
              <DealSaleRows
                key={deal.id}
                deal={deal}
                takes={dealFulfillment.get(deal.id) ?? []}
              />
            ))}
          </tbody>
        </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {sorted.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">{o.reference}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{o.agent?.company_name || o.agent?.full_name || o.agent?.email || "Portal order"}</p>
              </div>
              <p className="shrink-0 text-xs font-semibold">{formatMoney(o.currency, Number(o.total_amount))}</p>
            </div>
          ))}
          {sortedDeals.map((deal) => (
            <Link key={deal.id} href={adminDealPath(deal.id)} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-primary">{deal.reference}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{deal.accountName || "Offline deal"}</p>
              </div>
              <p className="shrink-0 text-xs font-semibold">{DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}</p>
            </Link>
          ))}
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
  expanded,
  onToggle,
  costLayers,
}: {
  order: AdminOrderListRow
  expanded: boolean
  onToggle: () => void
  costLayers: CostLayerRow[]
}) {
  const cogs = order.profit.cost_known ? order.profit.cogs : null
  const profit = order.profit.cost_known ? order.profit.gross_profit : null
  return (
    <>
      <tr className={cn("hover:bg-muted/30", expanded && "bg-muted/20")}>
        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
          <button type="button" onClick={onToggle} className="text-primary hover:underline">
            {order.reference}
          </button>
        </td>
        <td className="px-3 py-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Portal
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
        <td className="px-3 py-3 text-muted-foreground">{orderSupplierLabel(order)}</td>
        <td className="px-3 py-3">
          <AdminInvoiceStatusSelect
            key={`${order.invoice?.id ?? ""}-${order.invoice?.status ?? ""}`}
            invoiceId={order.invoice?.id ?? null}
            initialStatus={order.invoice?.status ?? null}
            deliveryProofs={order.deliveryProofs}
            className="max-w-[180px]"
          />
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatWhen(order.created_at)}
        </td>
      </tr>
      {expanded ? (
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
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Supplier fulfilment
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep the party on one supplier when that stock can cover the order.
                  </p>
                  <div className="mt-2">
                    <SupplierAllocationEditor order={order} costLayers={costLayers} />
                  </div>
                </div>
                <Link href="/admin/orders" className="text-xs font-medium text-primary hover:underline">
                  Open in orders
                </Link>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function DealSaleRows({
  deal,
  takes,
}: {
  deal: PackageDealSaleRow
  takes: SupplierAllocationTake[]
}) {
  const attributedCogs = cogsFromTakes(takes)
  const cogs = deal.cogs ?? attributedCogs
  const profit = cogs == null ? deal.grossProfit : deal.totalAmount - cogs
  const margin = profit == null || deal.totalAmount <= 0 ? deal.margin : profit / deal.totalAmount
  const supplier = deal.supplierLabel || summarizeSupplierTakes(takes) || "—"
  return (
      <tr className="hover:bg-muted/30">
        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
          <Link href={adminDealPath(deal.id)} className="text-primary hover:underline">
            {deal.reference}
          </Link>
        </td>
        <td className="px-3 py-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Offline deal
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
          {deal.lines.find((line) => line.supplierId && line.supplierName) ? (
            <SupplierNameLink
              supplierId={deal.lines.find((line) => line.supplierId)?.supplierId}
              name={supplier}
            />
          ) : (
            supplier
          )}
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground">
          {DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatWhen(deal.createdAt)}
        </td>
      </tr>
  )
}
