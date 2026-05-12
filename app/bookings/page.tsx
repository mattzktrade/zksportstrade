"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { PortalLayout } from "@/components/portal-layout"
import { bookings, packages } from "@/lib/data"
import {
  Search,
  Calendar,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
  Eye,
  Filter,
  ArrowUpDown,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

const statusConfig = {
  confirmed: {
    label: "Confirmed",
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
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "text-red-700 bg-red-50 border-red-200",
    dotColor: "bg-red-500",
  },
}

const statusFilters = [
  { value: "all", label: "All Bookings" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
]

export default function BookingsPage() {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortBy, setSortBy] = useState<"date" | "amount" | "created">("created")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null)

  const filteredBookings = useMemo(() => {
    const result = bookings.filter((booking) => {
      const searchMatch =
        search === "" ||
        booking.packageName.toLowerCase().includes(search.toLowerCase()) ||
        booking.clientName.toLowerCase().includes(search.toLowerCase()) ||
        booking.id.toLowerCase().includes(search.toLowerCase())

      const statusMatch = statusFilter === "all" || booking.status === statusFilter

      return searchMatch && statusMatch
    })

    // Sort
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
  }, [search, statusFilter, sortBy, sortOrder])

  const stats = useMemo(() => {
    const confirmed = bookings.filter((b) => b.status === "confirmed").length
    const pending = bookings.filter((b) => b.status === "pending").length
    const totalValue = bookings.reduce((sum, b) => sum + b.totalAmount, 0)
    return { confirmed, pending, totalValue }
  }, [])

  return (
    <PortalLayout>
      <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Bookings</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">Manage and track all your client bookings</p>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[90px] sm:min-w-[120px]">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Confirmed</p>
              <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.confirmed}</p>
            </div>
            <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[90px] sm:min-w-[120px]">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Pending</p>
              <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.pending}</p>
            </div>
            <div className="px-3 sm:px-4 lg:px-5 py-2 sm:py-3 bg-card border border-border rounded-lg min-w-[110px] sm:min-w-[160px]">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium mb-0.5 sm:mb-1">Total Value</p>
              <p className="text-lg sm:text-xl lg:text-2xl font-bold text-foreground">${stats.totalValue.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-card rounded-2xl border border-border">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by booking ID, package, or client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 sm:py-2.5 bg-muted/50 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg overflow-x-auto">
              {statusFilters.map((filter) => (
                <button
                  key={filter.value}
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

          {/* Sort */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [newSortBy, newSortOrder] = e.target.value.split("-") as [
                  "date" | "amount" | "created",
                  "asc" | "desc",
                ]
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

        {/* Bookings Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {/* Table Header */}
          <div className="hidden lg:grid grid-cols-[60px_2fr_1.5fr_80px_140px_110px_120px_80px] gap-3 p-4 bg-muted/30 border-b border-border text-sm font-medium text-muted-foreground">
            <div>ID</div>
            <div>Package</div>
            <div>Client</div>
            <div>Guests</div>
            <div>Event Date</div>
            <div>Status</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {filteredBookings.map((booking) => {
              const status = statusConfig[booking.status]
              const StatusIcon = status.icon
              const pkg = packages.find((p) => p.id === booking.packageId)
              const isExpanded = expandedBooking === booking.id

              return (
                <div key={booking.id}>
                  <div
                    className={cn(
                      "hidden lg:grid grid-cols-[60px_2fr_1.5fr_80px_140px_110px_120px_80px] gap-3 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer",
                      isExpanded && "bg-muted/30",
                    )}
                    onClick={() => setExpandedBooking(isExpanded ? null : booking.id)}
                  >
                    <div>
                      <span className="text-sm font-mono text-muted-foreground">{booking.id.slice(-6)}</span>
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
                          status.className,
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", status.dotColor)} />
                        {status.label}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground whitespace-nowrap">${booking.totalAmount.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="p-2 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        className="p-2 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        <Download className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <ChevronDown
                        className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")}
                      />
                    </div>
                  </div>

                  {/* Mobile View */}
                  <div
                    className={cn(
                      "md:hidden p-3 sm:p-4 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer",
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
                            status.className,
                          )}
                        >
                          <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", status.dotColor)} />
                          {status.label}
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

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                      <div className="p-3 sm:p-4 bg-muted/50 rounded-xl">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                          {/* Booking Details */}
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-3">Booking Details</h4>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <dt className="text-muted-foreground">Booking ID</dt>
                                <dd className="font-mono font-medium">{booking.id}</dd>
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
                                <dd className="font-medium capitalize">{pkg?.tier || "N/A"}</dd>
                              </div>
                            </dl>
                          </div>

                          {/* Client Details */}
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

                          {/* Payment */}
                          <div>
                            <h4 className="text-sm font-semibold text-foreground mb-3">Payment Summary</h4>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <dt className="text-muted-foreground">Per Person</dt>
                                <dd className="font-medium">
                                  ${(booking.totalAmount / booking.guests).toLocaleString()}
                                </dd>
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

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-border">
                          <Link
                            href={`/invoices?booking=${booking.id}`}
                            className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-foreground text-background rounded-lg text-xs sm:text-sm font-semibold hover:bg-foreground/90 transition-colors text-center"
                          >
                            View Invoice
                          </Link>
                          <button className="w-full sm:w-auto px-3 sm:px-4 py-2 border border-border rounded-lg text-xs sm:text-sm font-medium hover:bg-muted transition-colors">
                            Download PDF
                          </button>
                          {booking.status === "pending" && (
                            <button className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-primary text-white rounded-lg text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors sm:ml-auto">
                              Send Reminder
                            </button>
                          )}
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
    </PortalLayout>
  )
}
