import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"

export default async function AdminDashboardPage() {
  await requireAdmin()
  const supabase = await createClient()

  const [{ count: pending }, { count: packages }, { count: activeHolds }, { count: orders }] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("approval_status", "pending"),
    supabase.from("packages").select("*", { count: "exact", head: true }),
    supabase.from("inventory_holds").select("*", { count: "exact", head: true }).is("released_at", null),
    supabase.from("orders").select("*", { count: "exact", head: true }),
  ])

  const cards = [
    { label: "Pending signups", value: pending ?? 0, href: "/admin/pending-users" },
    { label: "Packages in catalog", value: packages ?? 0, href: "/admin/catalog" },
    { label: "Active inventory holds", value: activeHolds ?? 0, href: "/admin/inventory" },
    { label: "Portal orders", value: orders ?? 0, href: "/admin/orders" },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-4xl space-y-8">
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
    </div>
  )
}
