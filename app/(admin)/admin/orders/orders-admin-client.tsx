"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { adminPackagePath } from "@/lib/admin/package-link"
import { cn } from "@/lib/utils"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import {
  invoiceWorkflowStatusLabels,
  normalizeInvoiceStatus,
  type InvoiceWorkflowStatus,
} from "@/lib/invoices/status"
import { formatMoney } from "@/lib/format/money"

type InvoiceFilter = "all" | InvoiceWorkflowStatus

type SortKey =
  | "created"
  | "reference"
  | "package"
  | "agent"
  | "guests"
  | "total"
  | "cogs"
  | "profit"
  | "margin"
  | "payment_status"

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function agentPrimary(agent: AdminOrderListRow["agent"]): string {
  if (!agent) return "—"
  return (agent.company_name?.trim() || agent.full_name?.trim() || agent.email || "—").toString()
}

function agentSecondary(agent: AdminOrderListRow["agent"]): string {
  if (!agent) return ""
  const parts: string[] = []
  if (agent.company_name?.trim() && agent.full_name?.trim()) parts.push(agent.full_name.trim())
  if (agent.email) parts.push(agent.email)
  return parts.join(" · ")
}

function matchesSearch(o: AdminOrderListRow, q: string): boolean {
  if (!q) return true
  const n = q.toLowerCase().trim()
  const pkg = o.packages
  const haystack = [
    o.reference,
    pkg?.name ?? "",
    pkg?.circuit ?? "",
    o.agent?.company_name ?? "",
    o.agent?.full_name ?? "",
    o.agent?.email ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(n)
}

function matchesInvoiceFilter(o: AdminOrderListRow, f: InvoiceFilter): boolean {
  if (f === "all") return true
  if (!o.invoice) return false
  return normalizeInvoiceStatus(o.invoice.status) === f
}

function invoiceStatusRank(s: string): number {
  const n = normalizeInvoiceStatus(s)
  if (n === "awaiting_invoice") return 0
  if (n === "awaiting_payment") return 1
  return 2
}

function compare(a: AdminOrderListRow, b: AdminOrderListRow, key: SortKey, dir: "asc" | "desc"): number {
  const m = dir === "asc" ? 1 : -1
  const pkgA = a.packages?.name ?? ""
  const pkgB = b.packages?.name ?? ""
  switch (key) {
    case "created":
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * m
    case "reference":
      return a.reference.localeCompare(b.reference) * m
    case "package":
      return pkgA.localeCompare(pkgB) * m
    case "agent":
      return agentPrimary(a.agent).localeCompare(agentPrimary(b.agent)) * m
    case "guests":
      return (a.guests - b.guests) * m
    case "total":
      return (Number(a.total_amount) - Number(b.total_amount)) * m
    case "cogs": {
      const ca = a.profit.cogs ?? Number.POSITIVE_INFINITY
      const cb = b.profit.cogs ?? Number.POSITIVE_INFINITY
      return (ca - cb) * m
    }
    case "profit": {
      const pa = a.profit.gross_profit ?? Number.NEGATIVE_INFINITY
      const pb = b.profit.gross_profit ?? Number.NEGATIVE_INFINITY
      return (pa - pb) * m
    }
    case "margin": {
      const ma = a.profit.margin ?? Number.NEGATIVE_INFINITY
      const mb = b.profit.margin ?? Number.NEGATIVE_INFINITY
      return (ma - mb) * m
    }
    case "payment_status": {
      const diff = invoiceStatusRank(a.invoice?.status ?? "") - invoiceStatusRank(b.invoice?.status ?? "")
      return diff * m || a.reference.localeCompare(b.reference) * m
    }
    default:
      return 0
  }
}

function SortTh({
  label,
  activeKey,
  sortKey,
  sortDir,
  onSort,
  className,
  alignRight,
}: {
  label: string
  activeKey: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (k: SortKey) => void
  className?: string
  alignRight?: boolean
}) {
  const active = activeKey === sortKey
  return (
    <th className={cn("px-4 py-3 font-medium", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-xs uppercase tracking-wide",
          alignRight && "w-full justify-end",
        )}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  )
}

const invoiceFilterTabs: { value: InvoiceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting_invoice", label: invoiceWorkflowStatusLabels.awaiting_invoice },
  { value: "awaiting_payment", label: invoiceWorkflowStatusLabels.awaiting_payment },
  { value: "paid", label: invoiceWorkflowStatusLabels.paid },
]

export function OrdersAdminClient({ orders }: { orders: AdminOrderListRow[] }) {
  const [search, setSearch] = useState("")
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>("created")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "created" || key === "total" || key === "guests" ? "desc" : "asc")
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = orders
      .filter((o) => matchesSearch(o, q))
      .filter((o) => matchesInvoiceFilter(o, invoiceFilter))
    return [...rows].sort((a, b) => compare(a, b, sortKey, sortDir))
  }, [orders, search, invoiceFilter, sortKey, sortDir])

  const totals = useMemo(() => {
    type Bucket = {
      currency: string
      revenue: number
      pricedRevenue: number
      cogs: number
      profit: number
      ordersTotal: number
      ordersMissing: number
    }
    const map = new Map<string, Bucket>()
    let missing = 0
    for (const o of visible) {
      if (o.status === "cancelled") continue
      const cur = (o.currency || "USD").trim() || "USD"
      const b = map.get(cur) ?? {
        currency: cur,
        revenue: 0,
        pricedRevenue: 0,
        cogs: 0,
        profit: 0,
        ordersTotal: 0,
        ordersMissing: 0,
      }
      b.revenue += Number(o.total_amount)
      b.ordersTotal += 1
      if (o.profit.cost_known && o.profit.cogs != null && o.profit.gross_profit != null) {
        b.pricedRevenue += Number(o.total_amount)
        b.cogs += o.profit.cogs
        b.profit += o.profit.gross_profit
      } else {
        b.ordersMissing += 1
        missing += 1
      }
      map.set(cur, b)
    }
    return {
      buckets: [...map.values()].sort((a, b) => b.revenue - a.revenue),
      missing,
    }
  }, [visible])

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row gap-4 xl:items-end xl:justify-between">
        <div className="flex-1 min-w-0 max-w-xl">
          <label htmlFor="orders-search" className="sr-only">
            Search orders
          </label>
          <input
            id="orders-search"
            type="search"
            placeholder="Search booking reference, package, agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Invoice</span>
          <div className="flex flex-wrap gap-1.5">
            {invoiceFilterTabs.map((tab) => (
              <button
                key={String(tab.value)}
                type="button"
                onClick={() => setInvoiceFilter(tab.value)}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  invoiceFilter === tab.value
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{visible.length}</span> of{" "}
        <span className="font-medium text-foreground">{orders.length}</span> orders. New checkouts use invoice status{" "}
        <span className="font-medium text-foreground">{invoiceWorkflowStatusLabels.awaiting_invoice.toLowerCase()}</span> until you advance them.
      </p>

      {totals.buckets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.buckets.map((b) => {
            const margin = b.pricedRevenue > 0 ? b.profit / b.pricedRevenue : null
            return (
              <div key={b.currency} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gross profit · {b.currency}</p>
                <p
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    b.profit >= 0 ? "text-emerald-600" : "text-red-600",
                  )}
                >
                  {formatMoney(b.currency, b.profit)}
                  {margin != null ? (
                    <span className="text-xs text-muted-foreground ml-2">({formatPct(margin)})</span>
                  ) : null}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Revenue {formatMoney(b.currency, b.revenue)} · COGS {formatMoney(b.currency, b.cogs)}
                </p>
                {b.ordersMissing > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {b.ordersMissing} order{b.ordersMissing === 1 ? "" : "s"} missing buy price
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1280px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <SortTh label="Reference" activeKey={sortKey} sortKey="reference" sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Package" activeKey={sortKey} sortKey="package" sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Agent" activeKey={sortKey} sortKey="agent" sortDir={sortDir} onSort={toggleSort} />
                <SortTh
                  label="Guests"
                  activeKey={sortKey}
                  sortKey="guests"
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="text-right"
                  alignRight
                />
                <SortTh
                  label="Total"
                  activeKey={sortKey}
                  sortKey="total"
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="text-right"
                  alignRight
                />
                <SortTh
                  label="COGS"
                  activeKey={sortKey}
                  sortKey="cogs"
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="text-right"
                  alignRight
                />
                <SortTh
                  label="Gross profit"
                  activeKey={sortKey}
                  sortKey="profit"
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="text-right"
                  alignRight
                />
                <SortTh
                  label="Margin"
                  activeKey={sortKey}
                  sortKey="margin"
                  sortDir={sortDir}
                  onSort={toggleSort}
                  className="text-right"
                  alignRight
                />
                <SortTh
                  label="Payment"
                  activeKey={sortKey}
                  sortKey="payment_status"
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
                <SortTh label="Created" activeKey={sortKey} sortKey="created" sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((o) => {
                const pkg = o.packages
                return (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{o.reference}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={adminPackagePath(o.package_id, "orders")}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {pkg?.name ?? o.package_id}
                      </Link>
                      <p className="text-xs text-muted-foreground">{pkg?.circuit}</p>
                      <p className="text-[11px] text-primary mt-0.5">View product →</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{agentPrimary(o.agent)}</p>
                      {agentSecondary(o.agent) ? (
                        <p className="text-xs text-muted-foreground">{agentSecondary(o.agent)}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.guests}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatMoney(o.currency, Number(o.total_amount))}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {o.profit.cost_known && o.profit.cogs != null
                        ? formatMoney(o.profit.currency, o.profit.cogs)
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right tabular-nums font-medium",
                        o.profit.cost_known && o.profit.gross_profit != null
                          ? o.profit.gross_profit >= 0
                            ? "text-emerald-600"
                            : "text-red-600"
                          : "text-muted-foreground",
                      )}
                      title={
                        !o.profit.cost_known
                          ? "Cost basis missing for one or more units on this order. Add a buy price on the package cost layers."
                          : !o.profit.currency_consistent
                            ? "Some cost layers are in a different currency than the order; figures may be off."
                            : undefined
                      }
                    >
                      {o.profit.cost_known && o.profit.gross_profit != null
                        ? formatMoney(o.profit.currency, o.profit.gross_profit)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {o.profit.margin != null ? formatPct(o.profit.margin) : "—"}
                    </td>
                    <td className="px-4 py-3 min-w-[200px]">
                      <AdminInvoiceStatusSelect
                        key={`${o.invoice?.id ?? ""}-${o.invoice?.status ?? ""}`}
                        invoiceId={o.invoice?.id ?? null}
                        initialStatus={o.invoice?.status ?? null}
                        className="max-w-[200px]"
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                      {new Date(o.created_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {orders.length === 0 && <div className="p-10 text-center text-muted-foreground text-sm">No orders yet.</div>}
        {orders.length > 0 && visible.length === 0 && (
          <div className="p-10 text-center text-muted-foreground text-sm">No orders match your search or filters.</div>
        )}
      </div>
    </div>
  )
}
