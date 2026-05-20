import Link from "next/link"
import { Plus, Search, FileText, MessageSquare } from "lucide-react"

const actions = [
  {
    title: "New Booking",
    description: "Create a booking for your client",
    icon: Plus,
    href: "/packages",
    primary: true,
  },
  {
    title: "Search Packages",
    description: "Browse available experiences",
    icon: Search,
    href: "/packages",
  },
  {
    title: "My Bookings",
    description: "Check payment status",
    icon: FileText,
    href: "/bookings",
  },
  {
    title: "Get Support",
    description: "Chat with our team",
    icon: MessageSquare,
    href: "/faqs",
  },
]

export function QuickActions() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base sm:text-lg font-semibold text-foreground">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className={`
              flex flex-col gap-1.5 sm:gap-2 p-3 sm:p-4 rounded-xl transition-all
              ${
                action.primary
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted hover:bg-muted/80 text-foreground"
              }
            `}
          >
            <action.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${action.primary ? "text-white" : "text-primary"}`} />
            <div>
              <p className="font-semibold text-xs sm:text-sm">{action.title}</p>
              <p className={`text-[10px] sm:text-xs ${action.primary ? "text-white/70" : "text-muted-foreground"}`}>
                {action.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
