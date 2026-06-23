import { wixRequest, WixApiError } from "@/lib/integrations/wix/client"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { createAdminClient } from "@/lib/supabase/admin"

export type WixProductDeleteResult = {
  deleted: string[]
  errors: string[]
  skipped: boolean
}

/** Delete mapped Wix Stores products for a portal package (Catalog V1). */
export async function deleteWixProductsForPackage(packageId: string): Promise<WixProductDeleteResult> {
  if (!isWixConfigured()) {
    return { deleted: [], errors: [], skipped: true }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { deleted: [], errors: ["Service role not configured."], skipped: false }
  }

  const { data: listings, error } = await admin
    .from("channel_listings")
    .select("external_id")
    .eq("package_id", packageId.trim())
    .eq("channel", "wix")

  if (error) {
    return { deleted: [], errors: [error.message], skipped: false }
  }

  const deleted: string[] = []
  const errors: string[] = []

  for (const row of listings ?? []) {
    const productId = String(row.external_id ?? "").trim()
    if (!productId) continue
    try {
      await wixRequest("DELETE", `/stores/v1/products/${encodeURIComponent(productId)}`)
      deleted.push(productId)
    } catch (e) {
      if (e instanceof WixApiError && e.status === 404) {
        deleted.push(productId)
        continue
      }
      errors.push(`${productId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { deleted, errors, skipped: false }
}
