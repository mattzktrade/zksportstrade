import { requireAdmin } from "@/lib/admin/require-admin"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import { NegativeStockClient } from "./negative-stock-client"
import { AdminRouteShell } from "@/components/admin/admin-route-shell"

export const dynamic = "force-dynamic"

export default function NegativeStockPage() {
  return (
    <AdminRouteShell>
      <NegativeStockPageBody />
    </AdminRouteShell>
  )
}

async function NegativeStockPageBody() {
  await requireAdmin()
  const rows = await getNegativeStockRows()
  return <NegativeStockClient rows={rows} />
}
