"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminOrderListRow } from "@/lib/orders/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { normalizeInvoiceStatus, type InvoiceWorkflowStatus } from "@/lib/invoices/status"

type InvoiceFilter = "all" | "open" | InvoiceWorkflowStatus | "none"

type SortKey =
  | "created"
  | "reference"
  | "package"
  | "agent"
  | "guests"
  | "total"
  | "invoice_ref"
  | "invoice_status"

function formatMoney(currency: string, amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
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
    o.invoice?.reference ?? "",
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
  if (f === "none") return !o.invoice
  if (!o.invoice) return false
  const s = normalizeInvoiceStatus(o.invoice.status)
  if (f === "open") return s !== "paid"
  return s === f
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
    case "invoice_ref":
      return (a.invoice?.reference ?? "").localeCompare(b.invoice?.reference ?? "") * m
    case "invoice_status": {
      const diff = invoiceStatusRank(a.invoice?.status ?? "") - invoiceStatusRank(b.invoice?.status ?? "")
      return diff * m || (a.invoice?.reference ?? "").localeCompare(b.invoice?.reference ?? "") * m
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
  { value: "open", label: "Not paid" },
  { value: "awaiting_invoice", label: "To invoice" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "paid", label: "Paid" },
  { value: "none", label: "No invoice" },
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
            placeholder="Search reference, package, invoice, agent…"
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
        <span className="font-medium text-foreground">waiting to be invoiced</span> until you advance them.
      </p>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
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
                <SortTh label="Invoice" activeKey={sortKey} sortKey="invoice_ref" sortDir={sortDir} onSort={toggleSort} />
                <SortTh
                  label="Inv. status"
                  activeKey={sortKey}
                  sortKey="invoice_status"
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
                      <p className="font-medium text-foreground">{pkg?.name ?? o.package_id}</p>
                      <p className="text-xs text-muted-foreground">{pkg?.circuit}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{agentPrimary(o.agent)}</p>
                      {agentSecondary(o.agent) ? (
                        <p className="text-xs text-muted-foreground">{agentSecondary(o.agent)}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.guests}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatMoney(o.currency, Number(o.total_amount))}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {o.invoice?.reference ?? "—"}
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
