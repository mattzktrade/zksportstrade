"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { DashboardProfit, DashboardProfitPeriod, DashboardProfitTotals } from "@/lib/admin/cost-layers"
import { formatMoney } from "@/lib/format/money"

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function primaryBucket(period: DashboardProfitPeriod): DashboardProfitTotals | null {
  if (period.totalsByCurrency.length === 0) return null
  const usd = period.totalsByCurrency.find((b) => b.currency === "USD")
  return usd ?? period.totalsByCurrency[0]
}

function ProfitCards({ period }: { period: DashboardProfitPeriod }) {
  if (period.totalsByCurrency.length === 0) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
        No orders in this period.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {period.totalsByCurrency.map((b) => {
        const complete = b.orders_missing_cost === 0
        const profitClass = b.gross_profit >= 0 ? "text-emerald-600" : "text-red-600"
        return (
          <div key={b.currency} className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gross profit</p>
              <span className="text-[10px] font-mono text-muted-foreground">{b.currency}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${profitClass}`}>
              {formatMoney(b.currency, b.gross_profit)}
            </p>
            {complete ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                Margin {b.margin != null ? formatPct(b.margin) : "—"} on {formatMoney(b.currency, b.revenue)} revenue
              </p>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-200 tabular-nums">
                From {b.orders_priced} of {b.orders_total} orders · {formatMoney(b.currency, b.priced_revenue)} priced
                revenue
                {b.margin != null ? ` · ${formatPct(b.margin)} margin on priced only` : ""}
              </p>
            )}
            <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border">
              <p className="tabular-nums">
                Revenue: <span className="text-foreground font-medium">{formatMoney(b.currency, b.revenue)}</span>
              </p>
              <p className="tabular-nums">
                COGS: <span className="text-foreground font-medium">{formatMoney(b.currency, b.cogs)}</span>
              </p>
              <p className="tabular-nums">
                Orders priced:{" "}
                <span className="text-foreground font-medium">
                  {b.orders_priced} / {b.orders_total}
                </span>
              </p>
              {b.orders_missing_cost > 0 ? (
                <p className="tabular-nums text-amber-800 dark:text-amber-200 font-medium">
                  {b.orders_missing_cost} need buy price ({formatMoney(b.currency, b.unpriced_revenue)} excluded)
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MissingCostBanner({ period }: { period: DashboardProfitPeriod }) {
  if (period.ordersMissingCost <= 0) return null
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100 space-y-1">
      <p className="font-medium">
        {period.ordersMissingCost} of {period.ordersTotal} order{period.ordersTotal === 1 ? "" : "s"} in this period{" "}
        {period.periodKey === "all" ? "" : `(${period.label}) `}
        have no complete buy price — gross profit above excludes their revenue so totals are not inflated.
      </p>
      <p className="text-xs">
        Open each package in{" "}
        <Link href="/admin/catalog" className="underline font-medium">
          Catalog
        </Link>
        , set buy prices on cost layers (zero = not set), or use Inventory & cost on the product page. Historical COGS
        updates when you save with cascade enabled.
      </p>
    </div>
  )
}

function MonthlyTable({ monthly }: { monthly: DashboardProfitPeriod[] }) {
  if (monthly.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Month</th>
            <th className="px-4 py-3 font-medium text-right">Orders</th>
            <th className="px-4 py-3 font-medium text-right">Priced</th>
            <th className="px-4 py-3 font-medium text-right">Missing COGS</th>
            <th className="px-4 py-3 font-medium text-right">Revenue</th>
            <th className="px-4 py-3 font-medium text-right">COGS</th>
            <th className="px-4 py-3 font-medium text-right">Gross profit</th>
            <th className="px-4 py-3 font-medium text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {monthly.map((m) => {
            const b = primaryBucket(m)
            if (!b) return null
            const profitClass = b.gross_profit >= 0 ? "text-emerald-600" : "text-red-600"
            return (
              <tr key={m.periodKey} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">{m.label}</td>
                <td className="px-4 py-3 text-right tabular-nums">{m.ordersTotal}</td>
                <td className="px-4 py-3 text-right tabular-nums">{b.orders_priced}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {m.ordersMissingCost > 0 ? (
                    <span className="text-amber-800 dark:text-amber-200 font-medium">{m.ordersMissingCost}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(b.currency, b.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatMoney(b.currency, b.cogs)}
                </td>
                <td className={cn("px-4 py-3 text-right tabular-nums font-medium", profitClass)}>
                  {formatMoney(b.currency, b.gross_profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {b.margin != null ? formatPct(b.margin) : "—"}
                  {m.ordersMissingCost > 0 ? (
                    <span className="block text-[10px] text-amber-800 dark:text-amber-200">priced only</span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DashboardProfitSection({ profit }: { profit: DashboardProfit }) {
  const periods = useMemo(
    () => [profit.allTime, ...profit.monthly],
    [profit.allTime, profit.monthly],
  )

  const [selectedKey, setSelectedKey] = useState("all")

  const selected =
    periods.find((p) => p.periodKey === selectedKey) ?? profit.allTime

  const primary = primaryBucket(selected)
  const prevMonth =
    selected.periodKey === "all"
      ? null
      : profit.monthly[profit.monthly.findIndex((m) => m.periodKey === selected.periodKey) + 1] ?? null
  const prevPrimary = prevMonth ? primaryBucket(prevMonth) : null

  let profitDelta: string | null = null
  if (primary && prevPrimary && primary.currency === prevPrimary.currency) {
    const d = primary.gross_profit - prevPrimary.gross_profit
    profitDelta = `${d >= 0 ? "+" : ""}${formatMoney(primary.currency, d)} vs ${prevMonth?.label}`
  }

  const hasAnyOrders = profit.allTime.ordersTotal > 0

  if (!hasAnyOrders) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
        No completed orders yet. Once portal orders come in, gross profit appears here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-[200px]">
          Period
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
          >
            <option value="all">All time</option>
            {profit.monthly.map((m) => (
              <option key={m.periodKey} value={m.periodKey}>
                {m.label}
                {m.ordersMissingCost > 0 ? ` (${m.ordersMissingCost} need buy price)` : ""}
              </option>
            ))}
          </select>
        </label>
        {profitDelta ? (
          <p className="text-xs text-muted-foreground pb-2 tabular-nums">{profitDelta}</p>
        ) : null}
      </div>

      <ProfitCards period={selected} />
      <MissingCostBanner period={selected} />

      {profit.monthly.length > 0 ? (
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-semibold text-foreground">Monthly comparison</h3>
          <p className="text-xs text-muted-foreground">
            Margin is on priced revenue only when some orders still need buy prices. Set cost layers in Catalog to
            complete each month.
          </p>
          <MonthlyTable monthly={profit.monthly} />
        </div>
      ) : null}
    </div>
  )
}
