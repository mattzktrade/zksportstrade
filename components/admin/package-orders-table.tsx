"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateOrderSupplierAllocations } from "@/app/(admin)/actions"
import { cn } from "@/lib/utils"
import type { CostLayerRow } from "@/lib/admin/cost-layers"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { formatMoney } from "@/lib/format/money"

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
    const linked = order.supplierConsumptions
      .filter((c) => c.costLayerId)
      .map((c) => ({ costLayerId: c.costLayerId ?? "", quantity: String(c.quantity) }))
    return linked.length > 0 ? linked : [{ costLayerId: "", quantity: String(order.guests) }]
  }, [order.guests, order.supplierConsumptions])
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

export function PackageOrdersTable({
  orders,
  costLayers,
}: {
  orders: AdminOrderListRow[]
  costLayers: CostLayerRow[]
}) {
  if (orders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">
        No orders placed for this package yet.
      </p>
    )
  }

  const sorted = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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
  const cur = (sorted[0]?.currency || "USD").trim() || "USD"

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
        {sorted.length} order{sorted.length === 1 ? "" : "s"} for this package.{" "}
        <Link href="/admin/orders" className="text-primary hover:underline">
          View all orders
        </Link>
      </p>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs xl:text-sm min-w-[1120px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-3 font-medium">Reference</th>
              <th className="px-3 py-3 font-medium">Agent</th>
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
            {sorted.map((o) => (
              <tr key={o.id} className="hover:bg-muted/30">
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{o.reference}</td>
                <td className="px-3 py-3">
                  <p className="font-medium text-foreground">{agentPrimary(o.agent)}</p>
                  {o.agent?.email ? (
                    <p className="text-xs text-muted-foreground">{o.agent.email}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{o.guests}</td>
                <td className="px-3 py-3 text-right tabular-nums font-medium">
                  {formatMoney(o.currency, Number(o.total_amount))}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {o.profit.cost_known && o.profit.cogs != null
                    ? formatMoney(o.profit.currency, o.profit.cogs)
                    : "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-3 text-right tabular-nums font-medium",
                    o.profit.cost_known && o.profit.gross_profit != null
                      ? o.profit.gross_profit >= 0
                        ? "text-emerald-600"
                        : "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {o.profit.cost_known && o.profit.gross_profit != null
                    ? formatMoney(o.profit.currency, o.profit.gross_profit)
                    : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                  {o.profit.margin != null ? formatPct(o.profit.margin) : "—"}
                </td>
                <td className="px-3 py-3 align-top">
                  <SupplierAllocationEditor order={o} costLayers={costLayers} />
                </td>
                <td className="px-3 py-3">
                  <AdminInvoiceStatusSelect
                    key={`${o.invoice?.id ?? ""}-${o.invoice?.status ?? ""}`}
                    invoiceId={o.invoice?.id ?? null}
                    initialStatus={o.invoice?.status ?? null}
                    deliveryProofs={o.deliveryProofs}
                    className="max-w-[180px]"
                  />
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(o.created_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
