import Link from "next/link"
import { ArrowRight, Clock, CheckCircle2, FileText } from "lucide-react"
import { bookings } from "@/lib/data"
import { invoiceWorkflowStatusLabels, type InvoiceWorkflowStatus } from "@/lib/invoices/status"
import { cn } from "@/lib/utils"

const statusConfig: Record<
  InvoiceWorkflowStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  awaiting_invoice: {
    label: invoiceWorkflowStatusLabels.awaiting_invoice,
    icon: FileText,
    className: "text-slate-600 bg-slate-50",
  },
  awaiting_payment: {
    label: invoiceWorkflowStatusLabels.awaiting_payment,
    icon: Clock,
    className: "text-amber-600 bg-amber-50",
  },
  paid: {
    label: invoiceWorkflowStatusLabels.paid,
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-50",
  },
}

export function RecentBookings() {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border">
        <h3 className="text-base sm:text-lg font-semibold text-foreground">Recent Bookings</h3>
        <Link
          href="/bookings"
          className="flex items-center gap-1 text-xs sm:text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View All
          <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4" />
        </Link>
      </div>

      <div className="divide-y divide-border">
        {bookings.map((booking) => {
          const status = statusConfig[booking.invoiceStatus]
          const StatusIcon = status.icon

          return (
            <div key={booking.id} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-6 hover:bg-muted/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-1">
                  <p className="font-semibold text-sm sm:text-base text-foreground truncate">{booking.packageName}</p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium w-fit",
                      status.className,
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {booking.clientName} · {booking.guests} guests
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-semibold text-sm sm:text-base text-foreground">${booking.totalAmount.toLocaleString()}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {new Date(booking.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
