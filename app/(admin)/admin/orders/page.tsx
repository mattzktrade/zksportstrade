import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAllOrdersForAdmin } from "@/lib/orders/queries"

export default async function AdminOrdersPage() {
  await requireAdmin()
  const orders = await getAllOrdersForAdmin()

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only list of portal checkouts. Stock is decremented when an order is placed.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Package</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Guests</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => {
                const pkg = o.packages
                return (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{o.reference}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{pkg?.name ?? o.package_id}</p>
                      <p className="text-xs text-muted-foreground">{pkg?.circuit}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{o.client_name}</p>
                      <p className="text-xs text-muted-foreground">{o.client_email}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{o.guests}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {o.currency} {Number(o.total_amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 capitalize">{o.status}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">{o.agent_profile_id.slice(0, 8)}…</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(o.created_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {orders.length === 0 && (
          <div className="p-10 text-center text-muted-foreground text-sm">No orders yet.</div>
        )}
      </div>

      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← Back to dashboard
      </Link>
    </div>
  )
}
