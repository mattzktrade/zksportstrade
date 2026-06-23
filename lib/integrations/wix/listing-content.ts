import type { CatalogListingPayload } from "@/lib/catalog/listing-payload"
import { syncPackageCatalogToWix, type WixCatalogSyncResult } from "@/lib/integrations/wix/catalog-sync"
import { createAdminClient } from "@/lib/supabase/admin"

export type WixListingSyncResult = WixCatalogSyncResult

/** Push listing content, retail price + sellable stock to mapped Wix Stores lines (Phase 4). */
export async function syncListingContentToWix(
  packageId: string,
  _payload?: CatalogListingPayload,
): Promise<WixListingSyncResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, updated: 0, skipped: ["Service role not configured"], errors: [] }
  }

  const { data: pkg } = await admin.from("packages").select("sell_on_wix").eq("id", packageId).maybeSingle()
  if (!pkg?.sell_on_wix) {
    return { ok: true, updated: 0, skipped: ["sell_on_wix is false for this package"], errors: [] }
  }

  return syncPackageCatalogToWix(packageId)
}
