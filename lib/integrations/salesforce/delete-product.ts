import { SalesforceApiError, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { findProduct2IdByCode } from "@/lib/integrations/salesforce/products"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { createAdminClient } from "@/lib/supabase/admin"

export type SalesforceProductDeleteResult = {
  deleted: boolean
  product2Id: string | null
  error: string | null
  skipped: boolean
}

/** True when SF already removed the Product2 (or it was never there). Safe to treat as success. */
function isAlreadyDeletedError(e: unknown): boolean {
  if (e instanceof SalesforceApiError) {
    if (e.status === 404) return true
    const body = e.body
    const rows = Array.isArray(body) ? body : body ? [body] : []
    for (const row of rows) {
      if (!row || typeof row !== "object") continue
      const code = String((row as { errorCode?: string }).errorCode ?? "").toUpperCase()
      if (code === "ENTITY_IS_DELETED" || code === "NOT_FOUND") return true
    }
  }
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return (
    msg.includes("entity is deleted") ||
    msg.includes("entity_is_deleted") ||
    msg.includes("not found")
  )
}

/** Delete the Salesforce Product2 linked to a portal package, if any. */
export async function deleteSalesforceProductForPackage(
  packageId: string,
): Promise<SalesforceProductDeleteResult> {
  const status = await getSalesforceConnectionStatus()
  if (!status.connected) {
    return { deleted: false, product2Id: null, error: null, skipped: true }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { deleted: false, product2Id: null, error: "Service role not configured.", skipped: false }
  }

  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select("salesforce_product_id, product_code")
    .eq("id", packageId.trim())
    .maybeSingle()

  if (pkgErr) {
    return { deleted: false, product2Id: null, error: pkgErr.message, skipped: false }
  }
  if (!pkg) {
    return { deleted: false, product2Id: null, error: null, skipped: false }
  }

  let product2Id = (pkg as { salesforce_product_id: string | null }).salesforce_product_id?.trim() || null
  const productCode = (pkg as { product_code: string | null }).product_code?.trim() || null
  if (!product2Id && productCode) {
    product2Id = await findProduct2IdByCode(productCode)
  }

  if (!product2Id) {
    return { deleted: false, product2Id: null, error: null, skipped: false }
  }

  try {
    await salesforceRequest("DELETE", `/sobjects/Product2/${product2Id}`)
    return { deleted: true, product2Id, error: null, skipped: false }
  } catch (e) {
    // Shell/parent Product2 may already be gone in SF (manual delete, prior attempt, recycle bin).
    // Treat as success so portal package delete can finish.
    if (isAlreadyDeletedError(e)) {
      return { deleted: true, product2Id, error: null, skipped: false }
    }
    return {
      deleted: false,
      product2Id,
      error: e instanceof Error ? e.message : String(e),
      skipped: false,
    }
  }
}
