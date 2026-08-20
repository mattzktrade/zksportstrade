import { requireAdmin } from "@/lib/admin/require-admin"
import { getNegativeStockRows } from "@/lib/admin/negative-stock-query"
import { NegativeStockClient } from "./negative-stock-client"

export const dynamic = "force-dynamic"

export default async function NegativeStockPage() {
  await requireAdmin()
  const rows = await getNegativeStockRows()
  return <NegativeStockClient rows={rows} />
}
