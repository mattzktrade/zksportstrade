"use client"

import { useMemo } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { DashboardProfit, DashboardProfitPeriod, DashboardProfitTotals } from "@/lib/admin/cost-layers"
import { currentMonthKeyUtc, currentYearUtc } from "@/lib/admin/dashboard-period"
import { formatMoney } from "@/lib/format/money"

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function primaryBucket(period: DashboardProfitPeriod): DashboardProfitTotals | null {
  if (period.totalsByCurrency.length === 0) return null
  const usd = period.totalsByCurrency.find((b) => b.currency === "USD")
  return usd ?? period.totalsByCurrency[0]
}

function mergePeriods(periods: DashboardProfitPeriod[], label: string, periodKey: string): DashboardProfitPeriod {
  const buckets = new Map<string, DashboardProfitTotals>()
  let ordersTotal = 0
  let ordersMissingCost = 0

  for (const p of periods) {
    ordersTotal += p.ordersTotal
    ordersMissingCost += p.ordersMissingCost
    for (const b of p.totalsByCurrency) {
      const existing = buckets.get(b.currency) ?? {
        currency: b.currency,
        revenue: 0,
        cogs: 0,
        gross_profit: 0,
        margin: null,
        priced_revenue: 0,
        unpriced_revenue: 0,
        orders_priced: 0,
        orders_missing_cost: 0,
        orders_total: 0,
      }
      existing.revenue += b.revenue
      existing.cogs += b.cogs
      existing.gross_profit += b.gross_profit
      existing.priced_revenue += b.priced_revenue
      existing.unpriced_revenue += b.unpriced_revenue
      existing.orders_priced += b.orders_priced
      existing.orders_missing_cost += b.orders_missing_cost
      existing.orders_total += b.orders_total
      buckets.set(b.currency, existing)
    }
  }

  const totalsByCurrency = [...buckets.values()]
    .map((b) => ({
      ...b,
      margin: b.priced_revenue > 0 ? b.gross_profit / b.priced_revenue : null,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return { periodKey, label, totalsByCurrency, ordersTotal, ordersMissingCost }
}

function PeriodSummaryCard({
  title,
  period,
  href,
}: {
  title: string
  period: DashboardProfitPeriod
  href?: string
}) {
  const bucket = primaryBucket(period)
  const body = (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3 h-full">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {bucket ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">{period.ordersTotal}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Orders</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {formatMoney(bucket.currency, bucket.revenue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Revenue</p>
            </div>
          </div>
          <div className="pt-3 border-t border-border grid grid-cols-2 gap-4 text-sm">
            <div>
              <p
                className={cn(
                  "font-semibold tabular-nums",
                  bucket.gross_profit >= 0 ? "text-emerald-600" : "text-destructive",
                )}
              >
                {formatMoney(bucket.currency, bucket.gross_profit)}
              </p>
              <p className="text-xs text-muted-foreground">Gross profit</p>
            </div>
            <div>
              <p className="font-semibold tabular-nums text-foreground">
                {bucket.margin != null ? formatPct(bucket.margin) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Margin</p>
            </div>
          </div>
          {period.ordersMissingCost > 0 ? (
            <p className="text-[11px] text-amber-800 dark:text-amber-200">
              {period.ordersMissingCost} order{period.ordersMissingCost === 1 ? "" : "s"} need buy price
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No orders in this period.</p>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block hover:border-primary/30 transition-colors rounded-xl">
        {body}
      </Link>
    )
  }
  return body
}

function MonthlyTable({ monthly, year }: { monthly: DashboardProfitPeriod[]; year: number }) {
  const yearMonths = monthly.filter((m) => m.periodKey.startsWith(String(year)))
  if (yearMonths.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Month</th>
            <th className="px-4 py-3 font-medium text-right">Orders</th>
            <th className="px-4 py-3 font-medium text-right">Revenue</th>
            <th className="px-4 py-3 font-medium text-right">Gross profit</th>
            <th className="px-4 py-3 font-medium text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {yearMonths.map((m) => {
            const b = primaryBucket(m)
            if (!b) return null
            const profitClass = b.gross_profit >= 0 ? "text-emerald-600" : "text-destructive"
            return (
              <tr key={m.periodKey} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-foreground">{m.label}</td>
                <td className="px-4 py-3 text-right tabular-nums">{m.ordersTotal}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(b.currency, b.revenue)}</td>
                <td className={cn("px-4 py-3 text-right tabular-nums font-medium", profitClass)}>
                  {formatMoney(b.currency, b.gross_profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {b.margin != null ? formatPct(b.margin) : "—"}
                  {m.ordersMissingCost > 0 ? (
                    <span className="block text-[10px] text-amber-800 dark:text-amber-200">partial COGS</span>
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
  const year = currentYearUtc()
  const monthKey = currentMonthKeyUtc()

  const thisMonth = useMemo(
    () => profit.monthly.find((m) => m.periodKey === monthKey) ?? {
      periodKey: monthKey,
      label: "This month",
      totalsByCurrency: [],
      ordersMissingCost: 0,
      ordersTotal: 0,
    },
    [profit.monthly, monthKey],
  )

  const yearToDate = useMemo(
    () =>
      mergePeriods(
        profit.monthly.filter((m) => m.periodKey.startsWith(String(year))),
        `${year} (year to date)`,
        `ytd-${year}`,
      ),
    [profit.monthly, year],
  )

  const hasAnyOrders = profit.allTime.ordersTotal > 0

  if (!hasAnyOrders) {
    return (
      <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
        No trade portal orders yet. Revenue and profit appear here once bookings come in.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <PeriodSummaryCard title="This month" period={thisMonth} href="/admin/orders" />
        <PeriodSummaryCard title={`${year} year to date`} period={yearToDate} href="/admin/orders" />
      </div>

      {profit.monthly.some((m) => m.periodKey.startsWith(String(year))) ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{year} — month by month</h3>
          <MonthlyTable monthly={profit.monthly} year={year} />
        </div>
      ) : null}
    </div>
  )
}
