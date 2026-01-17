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
    className: "text-emerald-700 bg-emerald-50 border-emerald-200",
    dotColor: "bg-emerald-500",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className: "text-amber-700 bg-amber-50 border-amber-200",
    dotColor: "bg-amber-500",
  },
  overdue: {
    label: "Overdue",
    icon: AlertCircle,
    className: "text-red-700 bg-red-50 border-red-200",
    dotColor: "bg-red-500",
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
      <div className="p-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Invoices</h1>
          <p className="text-muted-foreground mt-1">View and manage all your booking invoices</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-emerald-100 rounded-xl">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Paid</span>
            </div>
            <p className="text-2xl font-bold text-foreground">${stats.paid.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {invoices.filter((i) => i.status === "paid").length} invoices
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-amber-100 rounded-xl">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold text-foreground">${stats.pending.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {invoices.filter((i) => i.status === "pending").length} invoices
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-red-100 rounded-xl">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Overdue</span>
            </div>
            <p className="text-2xl font-bold text-foreground">${stats.overdue.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {invoices.filter((i) => i.status === "overdue").length} invoices
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {["all", "paid", "pending", "overdue"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all",
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
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Invoice</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Package</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Issue Date</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Due Date</th>
                  <th className="text-right px-6 py-4 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.map((invoice) => {
                  const status = statusConfig[invoice.status]
                  const StatusIcon = status.icon

                  return (
                    <tr key={invoice.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded-lg">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <span className="font-mono font-semibold text-foreground">{invoice.id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{invoice.packageName}</p>
                        <p className="text-sm text-muted-foreground">Ref: {invoice.bookingId}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          <span className="font-bold text-foreground">{invoice.amount.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                            status.className,
                          )}
                        >
                          <StatusIcon className="h-3.5 w-3.5" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(invoice.issuedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {new Date(invoice.dueDate).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="View Invoice">
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="Download PDF">
                            <Download className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="Open in New Tab">
                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
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
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No invoices found</h3>
              <p className="text-muted-foreground">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  )
}
