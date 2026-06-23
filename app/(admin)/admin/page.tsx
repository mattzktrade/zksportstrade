import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { countPendingBookingApprovalRequests } from "@/lib/booking-approval/queries"
import { getDashboardProfit } from "@/lib/admin/cost-layers"
import { getDashboardActionCounts } from "@/lib/admin/dashboard-stats"
import { invoiceWorkflowStatusLabels } from "@/lib/invoices/status"
import { DashboardProfitSection } from "@/components/admin/dashboard-profit-section"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function ActionCard({
  value,
  label,
  href,
  tone,
}: {
  value: number
  label: string
  href: string
  tone?: "amber" | "blue"
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40",
        tone === "amber" && value > 0 && "border-amber-500/40 bg-amber-500/5",
        tone === "blue" && value > 0 && "border-sky-500/40 bg-sky-500/5",
        !tone || value === 0 ? "border-border" : "",
      )}
    >
      <p className="text-3xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-sm font-medium text-foreground mt-1">{label}</p>
      <p className="text-xs text-primary mt-2">View orders →</p>
    </Link>
  )
}

function StatCard({ value, label, href }: { value: number; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/30 transition-colors"
    >
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </Link>
  )
}

export default async function AdminDashboardPage() {
  await requireAdmin()
  const supabase = await createClient()

  const [{ count: pending }, { count: activeHolds }, paddockRequests, profit, actions] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    countPendingBookingApprovalRequests(),
    getDashboardProfit(),
    getDashboardActionCounts(),
  ])

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Action items for finance and ops, plus trade portal revenue at a glance.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ActionCard
            value={actions.awaitingPayment}
            label={invoiceWorkflowStatusLabels.awaiting_payment}
            href="/admin/orders?payment=awaiting_payment"
            tone="amber"
          />
          <ActionCard
            value={actions.awaitingDelivery}
            label="Awaiting delivery"
            href="/admin/orders?payment=paid"
            tone="blue"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Paid orders still need tickets sent — mark as delivered on the orders page once complete.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Approvals &amp; inventory</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Paddock requests" value={paddockRequests} href="/admin/booking-requests" />
          <StatCard label="Pending signups" value={pending ?? 0} href="/admin/pending-users" />
          <StatCard label="Active holds" value={activeHolds ?? 0} href="/admin/inventory" />
        </div>
      </section>

      <section className="space-y-4 pt-2 border-t border-border">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">Finance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Trade portal orders only. Gross profit = revenue minus COGS from cost layers.
            </p>
          </div>
          <Link href="/admin/orders" className="text-xs text-primary hover:underline shrink-0">
            All orders →
          </Link>
        </div>

        <DashboardProfitSection profit={profit} />
      </section>
    </div>
  )
}
