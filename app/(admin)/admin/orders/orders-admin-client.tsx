"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { toast } from "sonner"
import { cancelAdminOrder } from "@/app/(admin)/actions"
import { adminPackagePath } from "@/lib/admin/package-link"
import { cn } from "@/lib/utils"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { InvoicePdfDownloadLink } from "@/components/invoice-pdf-download-link"
import { invoiceDisplayStatus, invoiceWorkflowStatusLabels } from "@/lib/invoices/status"
import { formatMoney } from "@/lib/format/money"

type InvoiceFilter = "all" | "awaiting_payment" | "paid" | "delivered"

const ORDERS_FILTER_STORAGE_KEY = "zk-admin-orders-filters-v1"

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

function SupplierAllocations({ order }: { order: AdminOrderListRow }) {
  if (order.supplierAllocations.length === 0) {
    return <span className="text-xs text-muted-foreground">No supplier assigned</span>
  }
  return (
    <div className="space-y-0.5">
      {order.supplierAllocations.map((a) => (
        <p key={a.supplier} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{a.quantity}x</span> {a.supplier}
        </p>
      ))}
    </div>
  )
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
  return invoiceDisplayStatus(o.invoice.status) === f
}

function invoiceStatusRank(s: string): number {
  const n = invoiceDisplayStatus(s)
  if (n === "awaiting_payment") return 0
  if (n === "paid") return 1
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

function AdminOrderMobileCard({
  order: o,
  pending,
  onCancel,
}: {
  order: AdminOrderListRow
  pending: boolean
  onCancel: (o: AdminOrderListRow) => void
}) {
  const pkg = o.packages
  const profitTitle =
    !o.profit.cost_known
      ? "Cost basis missing for one or more units on this order. Add a buy price on the package cost layers."
      : !o.profit.currency_consistent
        ? "Some cost layers are in a different currency than the order; figures may be off."
        : undefined

  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-sm space-y-3",
        o.status === "cancelled" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-foreground break-all">{o.reference}</p>
          {o.status === "cancelled" ? (
            <span className="mt-1 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Cancelled
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {new Date(o.created_at).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div>
        <Link
          href={adminPackagePath(o.package_id, "orders")}
          className="font-medium text-foreground hover:text-primary hover:underline break-words"
        >
          {pkg?.name ?? o.package_id}
        </Link>
        {pkg?.circuit ? <p className="text-xs text-muted-foreground break-words">{pkg.circuit}</p> : null}
      </div>

      <div>
        <p className="font-medium text-foreground">{agentPrimary(o.agent)}</p>
        {agentSecondary(o.agent) ? (
          <p className="text-xs text-muted-foreground break-words">{agentSecondary(o.agent)}</p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Guests</dt>
          <dd className="mt-0.5 tabular-nums font-medium">{o.guests}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</dt>
          <dd className="mt-0.5 tabular-nums font-medium">{formatMoney(o.currency, Number(o.total_amount))}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">COGS</dt>
          <dd className="mt-0.5 tabular-nums text-muted-foreground">
            {o.profit.cost_known && o.profit.cogs != null
              ? formatMoney(o.profit.currency, o.profit.cogs)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Gross profit</dt>
          <dd
            className={cn(
              "mt-0.5 tabular-nums font-medium",
              o.profit.cost_known && o.profit.gross_profit != null
                ? o.profit.gross_profit >= 0
                  ? "text-emerald-600"
                  : "text-destructive"
                : "text-muted-foreground",
            )}
            title={profitTitle}
          >
            {o.profit.cost_known && o.profit.gross_profit != null
              ? formatMoney(o.profit.currency, o.profit.gross_profit)
              : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Margin</dt>
          <dd className="mt-0.5 tabular-nums text-muted-foreground">
            {o.profit.margin != null ? formatPct(o.profit.margin) : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Supplier allocation</dt>
          <dd className="mt-0.5">
            <SupplierAllocations order={o} />
          </dd>
        </div>
      </dl>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
        <AdminInvoiceStatusSelect
          key={`mobile-${o.invoice?.id ?? ""}-${o.invoice?.status ?? ""}`}
          invoiceId={o.invoice?.id ?? null}
          initialStatus={o.invoice?.status ?? null}
          deliveryProofs={o.deliveryProofs}
          className="w-full max-w-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        {o.invoice?.xero_invoice_number ? (
          <InvoicePdfDownloadLink orderId={o.id} label="PDF" />
        ) : (
          <span className="text-xs text-muted-foreground">No PDF</span>
        )}
        {o.status !== "cancelled" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onCancel(o)}
            className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
          >
            Cancel order
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </article>
  )
}

const invoiceFilterTabs: { value: InvoiceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting_payment", label: invoiceWorkflowStatusLabels.awaiting_payment },
  { value: "paid", label: invoiceWorkflowStatusLabels.paid },
  { value: "delivered", label: invoiceWorkflowStatusLabels.delivered },
]

export function OrdersAdminClient({
  orders,
  initialPaymentFilter,
}: {
  orders: AdminOrderListRow[]
  initialPaymentFilter?: InvoiceFilter
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [search, setSearch] = useState("")
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>(initialPaymentFilter ?? "all")
  const [sortKey, setSortKey] = useState<SortKey>("created")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [filtersReady, setFiltersReady] = useState(false)

  useEffect(() => {
    if (initialPaymentFilter) {
      setInvoiceFilter(initialPaymentFilter)
      setFiltersReady(true)
      return
    }
    try {
      const raw = localStorage.getItem(ORDERS_FILTER_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as {
        search?: string
        invoiceFilter?: InvoiceFilter
        sortKey?: SortKey
        sortDir?: "asc" | "desc"
      }
      if (typeof saved.search === "string") setSearch(saved.search)
      if (
        saved.invoiceFilter === "all" ||
        saved.invoiceFilter === "awaiting_payment" ||
        saved.invoiceFilter === "paid" ||
        saved.invoiceFilter === "delivered"
      ) {
        setInvoiceFilter(saved.invoiceFilter)
      }
      if (saved.sortKey) setSortKey(saved.sortKey)
      if (saved.sortDir === "asc" || saved.sortDir === "desc") setSortDir(saved.sortDir)
    } catch {
      /* ignore */
    } finally {
      setFiltersReady(true)
    }
  }, [initialPaymentFilter])

  useEffect(() => {
    if (!filtersReady) return
    localStorage.setItem(
      ORDERS_FILTER_STORAGE_KEY,
      JSON.stringify({ search, invoiceFilter, sortKey, sortDir }),
    )
  }, [search, invoiceFilter, sortKey, sortDir, filtersReady])

  function resetFilters() {
    setSearch("")
    setInvoiceFilter("all")
    setSortKey("created")
    setSortDir("desc")
  }

  function cancelOrder(o: AdminOrderListRow) {
    if (
      !window.confirm(
        `Cancel order ${o.reference}? This restores portal stock and keeps the row for records. You must close the Salesforce Opportunity separately if one was created.`,
      )
    ) {
      return
    }
    start(async () => {
      const res = await cancelAdminOrder(o.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message ?? "Order cancelled.", { duration: 10000 })
      router.refresh()
    })
  }

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
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Payment</span>
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
          {(search || invoiceFilter !== "all" || sortKey !== "created" || sortDir !== "desc") && (
            <button
              type="button"
              onClick={() => resetFilters()}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground border border-border"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{visible.length}</span> of{" "}
        <span className="font-medium text-foreground">{orders.length}</span> orders. Trade-portal invoices are created
        automatically in Xero when an order is placed.
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
                    b.profit >= 0 ? "text-emerald-600" : "text-destructive",
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

      <div className="rounded-xl border border-border bg-card overflow-hidden w-full">
        <div className="lg:hidden divide-y divide-border">
          {visible.map((o) => (
            <div key={o.id} className="p-3 sm:p-4">
              <AdminOrderMobileCard order={o} pending={pending} onCancel={cancelOrder} />
            </div>
          ))}
        </div>

        <div className="hidden lg:block overflow-x-auto w-full">
          <table className="w-full text-sm min-w-[1100px] table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <SortTh label="Reference" activeKey={sortKey} sortKey="reference" sortDir={sortDir} onSort={toggleSort} className="w-[148px]" />
                <SortTh label="Package" activeKey={sortKey} sortKey="package" sortDir={sortDir} onSort={toggleSort} className="w-[180px]" />
                <SortTh label="Agent" activeKey={sortKey} sortKey="agent" sortDir={sortDir} onSort={toggleSort} className="w-[140px]" />
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
                  className="w-[150px]"
                />
                <SortTh label="Created" activeKey={sortKey} sortKey="created" sortDir={sortDir} onSort={toggleSort} className="w-[130px]" />
                <th className="px-3 py-3 text-left font-medium text-muted-foreground w-[72px]">PDF</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground w-[72px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((o) => {
                const pkg = o.packages
                return (
                  <tr
                    key={o.id}
                    className={cn("hover:bg-muted/30", o.status === "cancelled" && "opacity-60")}
                  >
                    <td className="px-4 py-3 align-top overflow-hidden">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-mono text-xs leading-snug break-all">{o.reference}</span>
                        {o.status === "cancelled" ? (
                          <span className="inline-flex w-fit shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Cancelled
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top overflow-hidden">
                      <Link
                        href={adminPackagePath(o.package_id, "orders")}
                        className="font-medium text-foreground hover:text-primary hover:underline break-words"
                      >
                        {pkg?.name ?? o.package_id}
                      </Link>
                      {pkg?.circuit ? (
                        <p className="text-xs text-muted-foreground break-words">{pkg.circuit}</p>
                      ) : null}
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Suppliers
                        </p>
                        <SupplierAllocations order={o} />
                      </div>
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
                            : "text-destructive"
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
                    <td className="px-3 py-3">
                      <AdminInvoiceStatusSelect
                        key={`${o.invoice?.id ?? ""}-${o.invoice?.status ?? ""}`}
                        invoiceId={o.invoice?.id ?? null}
                        initialStatus={o.invoice?.status ?? null}
                        deliveryProofs={o.deliveryProofs}
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
                    <td className="px-4 py-3">
                      {o.invoice?.xero_invoice_number ? (
                        <InvoicePdfDownloadLink orderId={o.id} label="PDF" />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {o.status !== "cancelled" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => cancelOrder(o)}
                          className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
