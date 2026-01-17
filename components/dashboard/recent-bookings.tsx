import Link from "next/link"
import { ArrowRight, Clock, CheckCircle2, XCircle } from "lucide-react"
import { bookings } from "@/lib/data"
import { cn } from "@/lib/utils"

const statusConfig = {
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-50",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className: "text-amber-600 bg-amber-50",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "text-red-600 bg-red-50",
  },
}

export function RecentBookings() {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="flex items-center justify-between p-6 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Recent Bookings</h3>
        <Link
          href="/bookings"
          className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View All
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="divide-y divide-border">
        {bookings.map((booking) => {
          const status = statusConfig[booking.status]
          const StatusIcon = status.icon

          return (
            <div key={booking.id} className="flex items-center gap-4 p-6 hover:bg-muted/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <p className="font-semibold text-foreground truncate">{booking.packageName}</p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                      status.className,
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {booking.clientName} · {booking.guests} guests
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">${booking.totalAmount.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">
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
