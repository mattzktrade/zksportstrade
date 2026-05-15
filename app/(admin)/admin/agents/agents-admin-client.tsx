"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { adminPackagePath } from "@/lib/admin/package-link"
import type { AdminAgentWithStats } from "@/lib/admin/queries"
import { AdminInvoiceStatusSelect } from "@/components/admin-invoice-status-select"
import { formatMoney } from "@/lib/format/money"

export function AgentsAdminClient({ rows }: { rows: AdminAgentWithStats[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
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
          {rows.map((a) => {
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
                            first). Net sales exclude cancelled orders. Unpaid counts invoices that are not yet{" "}
                            <span className="font-medium">paid</span> (waiting to be invoiced or waiting for payment).
                            Agents see the same status on Invoices.
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
                                  <th className="px-3 py-2 font-medium">Invoice</th>
                                  <th className="px-3 py-2 font-medium">Inv. status</th>
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
                                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                                      {o.invoiceReference ?? "—"}
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
  )
}
