import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Units that have been "sold" from a package's own row, per the portal's own records:
 *   - Non-cancelled orders in the `orders` table.
 *   - Offline sales pulled from Salesforce into `salesforce_offline_sale_applications`.
 *
 * This is the authoritative count of consumed capacity for THIS specific package (not for
 * linked siblings). Use it when you need to reconstruct a package's expected qty_available
 * from its cost-layer baseline: `expected = totalReceived - localSold`.
 */
export async function readLocalSoldForPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const { data: orders } = await supabase
    .from("orders")
    .select("guests")
    .eq("package_id", packageId)
    .neq("status", "cancelled")
  const portalSold = (orders ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number((row as { guests: number | null }).guests) || 0)),
    0,
  )

  const { data: offlineRows } = await supabase
    .from("salesforce_offline_sale_applications")
    .select("quantity")
    .eq("package_id", packageId)
  const offlineSold = (offlineRows ?? []).reduce(
    (sum, row) =>
      sum + Math.max(0, Math.floor(Number((row as { quantity: number | null }).quantity) || 0)),
    0,
  )

  return Math.max(0, portalSold + offlineSold)
}
