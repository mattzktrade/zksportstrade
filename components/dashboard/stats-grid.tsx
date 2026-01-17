import type React from "react"
import { TrendingUp, TrendingDown, Ticket, DollarSign, Users, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string
  change: number
  icon: React.ElementType
  accent?: boolean
}

function StatCard({ title, value, change, icon: Icon, accent }: StatCardProps) {
  const isPositive = change >= 0

  return (
    <div
      className={cn(
        "relative p-6 rounded-2xl overflow-hidden",
        accent ? "bg-primary text-primary-foreground" : "bg-card border border-border",
      )}
    >
      {accent && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
      )}
      <div className="relative">
        <div
          className={cn(
            "inline-flex items-center justify-center h-12 w-12 rounded-xl mb-4",
            accent ? "bg-white/20" : "bg-muted",
          )}
        >
          <Icon className={cn("h-6 w-6", accent ? "text-white" : "text-primary")} />
        </div>
        <p className={cn("text-sm font-medium mb-1", accent ? "text-white/80" : "text-muted-foreground")}>{title}</p>
        <p className={cn("text-3xl font-bold tracking-tight", accent ? "text-white" : "text-foreground")}>{value}</p>
        <div
          className={cn(
            "flex items-center gap-1 mt-2 text-sm font-medium",
            accent ? "text-white/80" : isPositive ? "text-emerald-600" : "text-red-500",
          )}
        >
          {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          <span>
            {isPositive ? "+" : ""}
            {change}% vs last month
          </span>
        </div>
      </div>
    </div>
  )
}

export function StatsGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      <StatCard title="Total Bookings" value="47" change={12} icon={Ticket} accent />
      <StatCard title="Revenue (YTD)" value="$892.5K" change={8} icon={DollarSign} />
      <StatCard title="Active Clients" value="23" change={-3} icon={Users} />
      <StatCard title="Upcoming Events" value="8" change={25} icon={Calendar} />
    </div>
  )
}
