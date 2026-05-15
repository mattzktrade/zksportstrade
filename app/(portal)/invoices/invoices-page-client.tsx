"use client"

import { useState, useMemo } from "react"
import type { Invoice } from "@/lib/types/catalog"
import { invoiceWorkflowStatusLabels, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { Search, Filter, CheckCircle2, Clock, FileText, Send } from "lucide-react"
import { cn, formatMoney } from "@/lib/utils"

const statusConfig: Record<
  InvoiceWorkflowStatus,
  { label: string; icon: typeof CheckCircle2; className: string; dotColor: string }
> = {
  awaiting_invoice: {
    label: invoiceWorkflowStatusLabels.awaiting_invoice,
    icon: Send,
    className: "text-slate-700 bg-slate-50/50 dark:text-slate-200 dark:bg-slate-900/40",
    dotColor: "bg-slate-500",
  },
  awaiting_payment: {
    label: invoiceWorkflowStatusLabels.awaiting_payment,
    icon: Clock,
    className: "text-amber-700 bg-amber-50/50",
    dotColor: "bg-amber-600",
  },
  paid: {
    label: invoiceWorkflowStatusLabels.paid,
    icon: CheckCircle2,
    className: "text-emerald-700 bg-emerald-50/50",
    dotColor: "bg-emerald-600",
  },
}

const filterTabs: { value: "all" | InvoiceWorkflowStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting_invoice", label: "To invoice" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "paid", label: "Paid" },
]

function formatIssueDate(issuedAt: string | null) {
  if (!issuedAt) return "—"
  return new Date(issuedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function InvoicesPageClient({
  initialInvoices,
  highlightOrderId,
}: {
  initialInvoices: Invoice[]
  highlightOrderId?: string
}) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<(typeof filterTabs)[number]["value"]>("all")

  const filteredInvoices = useMemo(() => {
    return initialInvoices.filter((invoice) => {
      const q = search.toLowerCase()
      const orderMatch = !highlightOrderId || invoice.orderId === highlightOrderId
      const searchMatch =
        search === "" ||
        invoice.id.toLowerCase().includes(q) ||
        invoice.packageName.toLowerCase().includes(q) ||
        invoice.bookingId.toLowerCase().includes(q)

      const statusMatch = statusFilter === "all" || invoice.status === statusFilter

      return searchMatch && statusMatch && orderMatch
    })
  }, [initialInvoices, search, statusFilter, highlightOrderId])

  const stats = useMemo(() => {
    const paid = initialInvoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.amount, 0)
    const awaitingInvoice = initialInvoices
      .filter((i) => i.status === "awaiting_invoice")
      .reduce((sum, i) => sum + i.amount, 0)
    const awaitingPayment = initialInvoices
      .filter((i) => i.status === "awaiting_payment")
      .reduce((sum, i) => sum + i.amount, 0)
    return { paid, awaitingInvoice, awaitingPayment }
  }, [initialInvoices])

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Invoices</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">
            {invoiceWorkflowStatusLabels.awaiting_invoice}
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">{formatMoney(stats.awaitingInvoice)}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {initialInvoices.filter((i) => i.status === "awaiting_invoice").length} invoice
            {initialInvoices.filter((i) => i.status === "awaiting_invoice").length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">
            {invoiceWorkflowStatusLabels.awaiting_payment}
          </p>
          <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">{formatMoney(stats.awaitingPayment)}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {initialInvoices.filter((i) => i.status === "awaiting_payment").length} invoice
            {initialInvoices.filter((i) => i.status === "awaiting_payment").length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">{invoiceWorkflowStatusLabels.paid}</p>
          <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">{formatMoney(stats.paid)}</p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {initialInvoices.filter((i) => i.status === "paid").length} invoice
            {initialInvoices.filter((i) => i.status === "paid").length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 sm:py-2.5 bg-card border border-border rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap",
                statusFilter === tab.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Invoice</th>
                <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Package</th>
                <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground hidden md:table-cell">
                  Issue Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredInvoices.map((invoice) => {
                const status = statusConfig[invoice.status]
                const highlighted = highlightOrderId && invoice.orderId === highlightOrderId

                return (
                  <tr
                    key={`${invoice.id}-${invoice.orderId ?? ""}`}
                    className={cn("hover:bg-muted/30 transition-colors", highlighted && "bg-primary/5")}
                  >
                    <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="p-1.5 sm:p-2 bg-muted rounded-lg flex-shrink-0">
                          <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                        </div>
                        <span className="font-mono text-xs sm:text-sm font-semibold text-foreground">{invoice.id}</span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                      <p className="text-xs sm:text-sm font-medium text-foreground">{invoice.packageName}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Order: {invoice.bookingId}</p>
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                      <span className="text-sm sm:text-base font-bold text-foreground">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-[10px] sm:text-xs font-medium",
                          status.className,
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", status.dotColor)} />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm text-muted-foreground hidden md:table-cell">
                      {formatIssueDate(invoice.issuedAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filteredInvoices.length === 0 && (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">No invoices found</h3>
            <p className="text-sm sm:text-base text-muted-foreground">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  )
}
