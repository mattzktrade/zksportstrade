"use client"

import { useState, useMemo } from "react"
import { PortalLayout } from "@/components/portal-layout"
import { invoices } from "@/lib/data"
import {
  Search,
  Download,
  Eye,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  DollarSign,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"

const statusConfig = {
  paid: {
    label: "Paid",
    icon: CheckCircle2,
    className: "text-emerald-700 bg-emerald-50/50",
    dotColor: "bg-emerald-600",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className: "text-amber-700 bg-amber-50/50",
    dotColor: "bg-amber-600",
  },
  overdue: {
    label: "Overdue",
    icon: AlertCircle,
    className: "text-red-700 bg-red-50/50",
    dotColor: "bg-red-600",
  },
}

export default function InvoicesPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const searchMatch =
        search === "" ||
        invoice.id.toLowerCase().includes(search.toLowerCase()) ||
        invoice.packageName.toLowerCase().includes(search.toLowerCase())

      const statusMatch = statusFilter === "all" || invoice.status === statusFilter

      return searchMatch && statusMatch
    })
  }, [search, statusFilter])

  const stats = useMemo(() => {
    const paid = invoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.amount, 0)
    const pending = invoices.filter((i) => i.status === "pending").reduce((sum, i) => sum + i.amount, 0)
    const overdue = invoices.filter((i) => i.status === "overdue").reduce((sum, i) => sum + i.amount, 0)
    return { paid, pending, overdue }
  }, [])

  return (
    <PortalLayout>
      <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Invoices</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">View and manage all your booking invoices</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Paid</p>
            <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">${stats.paid.toLocaleString()}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {invoices.filter((i) => i.status === "paid").length} invoice{invoices.filter((i) => i.status === "paid").length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Pending</p>
            <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">${stats.pending.toLocaleString()}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {invoices.filter((i) => i.status === "pending").length} invoice{invoices.filter((i) => i.status === "pending").length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 sm:mb-2">Overdue</p>
            <p className="text-2xl sm:text-3xl font-bold text-foreground mb-1">${stats.overdue.toLocaleString()}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {invoices.filter((i) => i.status === "overdue").length} invoice{invoices.filter((i) => i.status === "overdue").length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Filters */}
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
            {["all", "paid", "pending", "overdue"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium capitalize transition-all whitespace-nowrap",
                  statusFilter === status
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {status === "all" ? "All" : status}
              </button>
            ))}
          </div>
        </div>

        {/* Invoices Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Invoice</th>
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Package</th>
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground hidden md:table-cell">Issue Date</th>
                  <th className="text-left px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground hidden md:table-cell">Due Date</th>
                  <th className="text-right px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.map((invoice) => {
                  const status = statusConfig[invoice.status]
                  const StatusIcon = status.icon

                  return (
                    <tr key={invoice.id} className="hover:bg-muted/30 transition-colors">
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
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Ref: {invoice.bookingId}</p>
                      </td>
                      <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          <span className="text-sm sm:text-base font-bold text-foreground">${invoice.amount.toLocaleString()}</span>
                        </div>
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
                        {new Date(invoice.issuedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm text-muted-foreground hidden md:table-cell">
                        {new Date(invoice.dueDate).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
                        <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                          <button className="p-1.5 sm:p-2 rounded-lg hover:bg-muted transition-colors" title="View Invoice">
                            <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          </button>
                          <button className="p-1.5 sm:p-2 rounded-lg hover:bg-muted transition-colors" title="Download PDF">
                            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          </button>
                          <button className="p-1.5 sm:p-2 rounded-lg hover:bg-muted transition-colors" title="Open in New Tab">
                            <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                          </button>
                        </div>
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
    </PortalLayout>
  )
}
