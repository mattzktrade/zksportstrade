"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import type { Booking } from "@/lib/types/catalog"
import { invoiceWorkflowStatusLabels, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { Search, Calendar, Users, Filter, ArrowUpDown, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const paymentStatusConfig: Record<
  InvoiceWorkflowStatus,
  { label: string; className: string; dotColor: string }
> = {
  awaiting_invoice: {
    label: invoiceWorkflowStatusLabels.awaiting_invoice,
    className: "text-slate-700 bg-slate-50/50 dark:text-slate-200 dark:bg-slate-900/40",
    dotColor: "bg-slate-500",
  },
  awaiting_payment: {
    label: invoiceWorkflowStatusLabels.awaiting_payment,
    className: "text-amber-700 bg-amber-50/50",
    dotColor: "bg-amber-600",
  },
  paid: {
    label: invoiceWorkflowStatusLabels.paid,
    className: "text-emerald-700 bg-emerald-50/50",
    dotColor: "bg-emerald-600",
  },
}

const paymentFilters: { value: "all" | InvoiceWorkflowStatus; label: string }[] = [
  { value: "all", label: "All Bookings" },
  { value: "awaiting_invoice", label: "To invoice" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "paid", label: "Paid" },
]

export function BookingsPageClient({ initialBookings }: { initialBookings: Booking[] }) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState<"date" | "amount" | "created">("created")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null)

  const filteredBookings = useMemo(() => {
    const q = search.toLowerCase()
    const result = initialBookings.filter((booking) => {
      const ref = (booking.orderReference ?? "").toLowerCase()
      const searchMatch =
        search === "" ||
        booking.packageName.toLowerCase().includes(q) ||
        booking.clientName.toLowerCase().includes(q) ||
        booking.id.toLowerCase().includes(q) ||
        ref.includes(q)

      const statusMatch = statusFilter === "all" || booking.invoiceStatus === statusFilter

      return searchMatch && statusMatch
    })

    result.sort((a, b) => {
      let comparison = 0
      if (sortBy === "date") {
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
      } else if (sortBy === "amount") {
        comparison = a.totalAmount - b.totalAmount
      } else {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      return sortOrder === "asc" ? comparison : -comparison
    })

    return result
  }, [initialBookings, search, statusFilter, sortBy, sortOrder])

  const stats = useMemo(() => {
    const awaitingPayment = initialBookings.filter((b) => b.invoiceStatus === "awaiting_payment").length
    const paid = initialBookings.filter((b) => b.invoiceStatus === "paid").length
    const totalValue = initialBookings.reduce((sum, b) => sum + b.totalAmount, 0)
    return { awaitingPayment, paid, totalValue }
  }, [initialBookings])

  const tableGrid =
    "grid-cols-[100px_2fr_1.5fr_80px_140px_1fr_120px_40px]"

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Bookings</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">Manage and track all your client bookings</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[90px] sm:min-w-[120px]">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Awaiting payment</p>
            <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.awaitingPayment}</p>
          </div>
          <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[90px] sm:min-w-[120px]">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Paid</p>
            <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.paid}</p>
          </div>
          <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[110px] sm:min-w-[160px]">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Total Value</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground">${stats.totalValue.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-card rounded-2xl border border-border">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by reference, package, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 sm:py-2.5 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg overflow-x-auto">
            {paymentFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  "px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap",
                  statusFilter === filter.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [newSortBy, newSortOrder] = e.target.value.split("-") as ["date" | "amount" | "created", "asc" | "desc"]
              setSortBy(newSortBy)
              setSortOrder(newSortOrder)
            }}
            className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-muted/50 rounded-lg text-xs sm:text-sm font-medium focus:outline-none"
          >
            <option value="created-desc">Newest First</option>
            <option value="created-asc">Oldest First</option>
            <option value="date-asc">Event Date (Soon)</option>
            <option value="date-desc">Event Date (Later)</option>
            <option value="amount-desc">Highest Value</option>
            <option value="amount-asc">Lowest Value</option>
          </select>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className={cn("hidden lg:grid gap-3 p-4 bg-muted/30 border-b border-border text-sm font-medium text-muted-foreground", tableGrid)}>
          <div>Ref</div>
          <div>Package</div>
          <div>Client</div>
          <div>Guests</div>
          <div>Event Date</div>
          <div>Payment</div>
          <div className="text-right">Amount</div>
          <div />
        </div>

        <div className="divide-y divide-border">
          {filteredBookings.map((booking) => {
            const paymentStatus = paymentStatusConfig[booking.invoiceStatus]
            const isExpanded = expandedBooking === booking.id
            const shortRef = (booking.orderReference ?? booking.id).replace(/^ZK-\d{4}-/i, "").slice(0, 8)

            return (
              <div key={booking.id}>
                <div
                  className={cn(
                    "hidden lg:grid gap-3 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer",
                    tableGrid,
                    isExpanded && "bg-muted/30",
                  )}
                  onClick={() => setExpandedBooking(isExpanded ? null : booking.id)}
                >
                  <div>
                    <span className="text-xs font-mono text-muted-foreground" title={booking.orderReference ?? booking.id}>
                      {shortRef.toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{booking.packageName}</p>
                    <p className="text-sm text-muted-foreground truncate">{booking.circuit}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{booking.clientName}</p>
                    <p className="text-sm text-muted-foreground truncate">{booking.clientEmail}</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium">{booking.guests}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm whitespace-nowrap">
                        {new Date(booking.date).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap",
                        paymentStatus.className,
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", paymentStatus.dotColor)} />
                      {paymentStatus.label}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-foreground whitespace-nowrap">${booking.totalAmount.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center justify-end">
                    <ChevronDown
                      className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")}
                    />
                  </div>
                </div>

                <div
                  className={cn(
                    "lg:hidden p-3 sm:p-4 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer",
                    isExpanded && "bg-muted/30",
                  )}
                  onClick={() => setExpandedBooking(isExpanded ? null : booking.id)}
                >
                  <div className="flex items-start justify-between gap-3 sm:gap-4 mb-2 sm:mb-3">
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-sm sm:text-base font-semibold text-foreground truncate mb-0.5 sm:mb-1">{booking.packageName}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">{booking.circuit}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 sm:gap-2 flex-shrink-0">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-medium whitespace-nowrap",
                          paymentStatus.className,
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", paymentStatus.dotColor)} />
                        {paymentStatus.label}
                      </span>
                      <p className="text-sm sm:text-base font-bold text-foreground">${booking.totalAmount.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span>{booking.guests} guests</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span>
                          {new Date(booking.date).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4 transition-transform flex-shrink-0", isExpanded && "rotate-180")}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="p-3 sm:p-4 bg-muted/50 rounded-xl">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3">Booking Details</h4>
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground shrink-0">Reference</dt>
                              <dd className="font-mono font-medium text-right">{booking.orderReference ?? booking.id}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Created</dt>
                              <dd className="font-medium">
                                {new Date(booking.createdAt).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Package Tier</dt>
                              <dd className="font-medium capitalize">{booking.packageTier ?? "—"}</dd>
                            </div>
                          </dl>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3">Client Information</h4>
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Name</dt>
                              <dd className="font-medium">{booking.clientName}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Email</dt>
                              <dd className="font-medium">{booking.clientEmail}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Guests</dt>
                              <dd className="font-medium">{booking.guests} people</dd>
                            </div>
                          </dl>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-3">Payment Summary</h4>
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground shrink-0">Status</dt>
                              <dd>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium",
                                    paymentStatus.className,
                                  )}
                                >
                                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", paymentStatus.dotColor)} />
                                  {paymentStatus.label}
                                </span>
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Per Person</dt>
                              <dd className="font-medium">${(booking.totalAmount / booking.guests).toLocaleString()}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-muted-foreground">Guests</dt>
                              <dd className="font-medium">× {booking.guests}</dd>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-border">
                              <dt className="font-semibold text-foreground">Total</dt>
                              <dd className="font-bold text-primary">${booking.totalAmount.toLocaleString()}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {filteredBookings.length === 0 && (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">No bookings found</h3>
            <p className="text-sm sm:text-base text-muted-foreground mb-4">Try adjusting your search or filters</p>
            <Link
              href="/packages"
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Browse Packages
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
