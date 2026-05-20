import Link from "next/link"
import nextDynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { getDashboardProfit } from "@/lib/admin/cost-layers"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"
import { DashboardProfitSection } from "@/components/admin/dashboard-profit-section"

export const dynamic = "force-dynamic"

export default async function AdminDashboardPage() {
  await requireAdmin()
  const supabase = await createClient()

  const [{ count: pending }, { count: packages }, { count: activeHolds }, { count: orders }, profit] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
      supabase.from("packages").select("*", { count: "exact", head: true }),
      supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
      supabase.from("orders").select("*", { count: "exact", head: true }),
      getDashboardProfit(),
    ])

  const cards = [
    { label: "Pending signups", value: pending ?? 0, href: "/admin/pending-users" },
    { label: "Packages in catalog", value: packages ?? 0, href: "/admin/catalog" },
    { label: "Active holds", value: activeHolds ?? 0, href: "/admin/inventory" },
    { label: "Portal orders", value: orders ?? 0, href: "/admin/orders" },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal tools for catalog, approvals, inventory, and portal orders.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/30 transition-colors"
          >
            <p className="text-3xl font-bold text-foreground tabular-nums">{c.value}</p>
            <p className="text-sm text-muted-foreground mt-1">{c.label}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold text-foreground">Gross profit</h2>
          <Link href="/admin/orders" className="text-xs text-primary hover:underline">
            View order-level breakdown →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Revenue from non-cancelled orders minus COGS from cost layers. Orders without a buy price (or still at $0) are
          excluded from profit and margin so totals are not inflated. Re-pricing a layer cascades to historical sales.
        </p>

        <DashboardProfitSection profit={profit} />
      </section>
    </div>
  )
}
