"use client"

import { Fragment, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { adminPackagePath } from "@/lib/admin/package-link"
import type { AdminAgentWithStats } from "@/lib/admin/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { formatMoney } from "@/lib/format/money"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { pageSearchProps } from "@/lib/browser/laptop-qol"

export function AgentsAdminClient({
  rows,
  initialQuery = "",
}: {
  rows: AdminAgentWithStats[]
  initialQuery?: string
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = usePersistedAdminFilters(
    "zk-admin-agents-filters-v1",
    { query: "" },
    { override: initialQuery.trim() ? { query: initialQuery } : null },
  )
  const needle = filters.query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!needle) return rows
    return rows.filter((a) => {
      const blob = `${a.email} ${a.full_name} ${a.company_name} ${a.mobile ?? ""} ${a.orderSearchBlob}`.toLowerCase()
      return blob.includes(needle)
    })
  }, [needle, rows])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          {...pageSearchProps}
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          placeholder="Search name, company, email, order ref, or package"
          className="flex-1 min-w-[200px] max-w-md px-4 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {needle ? (
          <button
            type="button"
            onClick={() => setFilters({ query: "" })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents match that search.</p>
      ) : (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="p-3 font-medium w-10" aria-label="Expand" />
            <th className="p-3 font-medium">Company</th>
            <th className="p-3 font-medium">Contact</th>
            <th className="p-3 font-medium">Mobile</th>
            <th className="p-3 font-medium">Email</th>
            <th className="p-3 font-medium text-right tabular-nums">Orders</th>
            <th className="p-3 font-medium text-right tabular-nums">Unpaid inv.</th>
            <th className="p-3 font-medium min-w-[140px]">Net sales</th>
            <th className="p-3 font-medium whitespace-nowrap">Joined</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => {
            const open = expandedId === a.id
            return (
              <Fragment key={a.id}>
                <tr className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="p-2 align-middle">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : a.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-expanded={open}
                      aria-label={open ? "Collapse order detail" : "Expand order detail"}
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="p-3 font-medium text-foreground">{a.company_name || "—"}</td>
                  <td className="p-3 text-muted-foreground">{a.full_name || "—"}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{a.mobile?.trim() || "—"}</td>
                  <td className="p-3 text-muted-foreground">{a.email}</td>
                  <td className="p-3 text-right tabular-nums font-medium text-foreground">{a.orderCount}</td>
                  <td className="p-3 text-right tabular-nums">
                    {a.outstandingInvoiceCount > 0 ? (
                      <span className="font-semibold text-amber-800 dark:text-amber-200">{a.outstandingInvoiceCount}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="p-3 text-foreground text-xs sm:text-sm leading-snug">{a.revenueSummary}</td>
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
                {open && (
                  <tr key={`${a.id}-detail`} className="border-b border-border bg-muted/25">
                    <td colSpan={9} className="p-0">
                      <div className="px-4 py-4 sm:px-6 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
                          <p>
                            <span className="font-medium text-foreground">Recent orders</span> (up to 40, newest
                            first). Net sales exclude cancelled orders.                             Unpaid counts bookings that are not yet{" "}
                            <span className="font-medium">paid</span> (confirmed or awaiting payment).
                            Agents see the same payment status on My Bookings.
                          </p>
                          <Link href="/admin/orders" className="text-primary font-medium hover:underline shrink-0">
                            View all orders
                          </Link>
                        </div>
                        {a.recentOrders.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">No orders for this agent yet.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-border bg-card">
                            <table className="w-full text-xs sm:text-sm">
                              <thead>
                                <tr className="border-b border-border bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                  <th className="px-3 py-2 font-medium">Reference</th>
                                  <th className="px-3 py-2 font-medium">Date</th>
                                  <th className="px-3 py-2 font-medium">Package</th>
                                  <th className="px-3 py-2 font-medium text-right">Total</th>
                                  <th className="px-3 py-2 font-medium">Payment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {a.recentOrders.map((o) => (
                                  <tr key={o.orderId} className="border-b border-border last:border-0">
                                    <td className="px-3 py-2 font-mono text-[11px] sm:text-xs">{o.reference}</td>
                                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                      {new Date(o.createdAt).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Link
                                        href={adminPackagePath(o.packageId, "orders")}
                                        className="font-medium text-foreground hover:text-primary hover:underline"
                                      >
                                        {o.packageName}
                                      </Link>
                                      <p className="text-[11px] text-muted-foreground">{o.circuit}</p>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                                      {formatMoney(o.currency, o.totalAmount)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <AdminInvoiceStatusSelect
                                        key={`${o.invoiceId ?? ""}-${o.invoiceStatus ?? ""}`}
                                        invoiceId={o.invoiceId}
                                        initialStatus={o.invoiceStatus}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      </div>
      <div className="divide-y divide-border md:hidden">
        {filtered.map((a) => {
          const open = expandedId === a.id
          return (
            <div key={a.id} className="p-4 space-y-2">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : a.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{a.company_name || "—"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.full_name || a.email}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{a.email}</p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="font-semibold">{a.orderCount} orders</p>
                  {a.outstandingInvoiceCount > 0 ? (
                    <p className="mt-0.5 font-semibold text-amber-800">{a.outstandingInvoiceCount} unpaid</p>
                  ) : null}
                </div>
              </button>
              <p className="text-xs text-muted-foreground">{a.revenueSummary}</p>
              {open ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  {a.recentOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No orders for this agent yet.</p>
                  ) : (
                    a.recentOrders.slice(0, 8).map((o) => (
                      <div key={o.orderId} className="flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="font-mono font-medium">{o.reference}</p>
                          <p className="text-muted-foreground">{o.packageName}</p>
                        </div>
                        <p className="shrink-0 font-medium">{formatMoney(o.currency, o.totalAmount)}</p>
                      </div>
                    ))
                  )}
                  <Link href="/admin/orders" className="inline-block text-xs font-medium text-primary">View all orders</Link>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
      )}
    </div>
  )
}
