import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Non-cancelled trade-portal order guests for a package (excludes Salesforce offline apps).
 */
export async function readPortalOrderSoldForPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const { data: orders } = await supabase
    .from("orders")
    .select("guests")
    .eq("package_id", packageId)
    .neq("status", "cancelled")
  return (orders ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.floor(Number((row as { guests: number | null }).guests) || 0)),
    0,
  )
}

/**
 * Units that have been "sold" from a package's own row, per the portal's own records:
 *   - Non-cancelled orders in the `orders` table.
 *   - Offline sales pulled from Salesforce into `salesforce_offline_sale_applications`.
 *
 * Prefer live Closed Won OLI + {@link readPortalOrderSoldForPackage} for inventory / Stock
 * Source commitment math — offline apps go stale after Closed Lost until revoked.
 */
export async function readLocalSoldForPackage(
  supabase: SupabaseClient,
  packageId: string,
): Promise<number> {
  const portalSold = await readPortalOrderSoldForPackage(supabase, packageId)

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
