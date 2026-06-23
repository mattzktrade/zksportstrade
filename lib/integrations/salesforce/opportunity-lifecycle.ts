import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceRequest } from "@/lib/integrations/salesforce/client"
import { formatSalesforceSyncError } from "@/lib/integrations/salesforce/format-error"
import { resolveProduct2IdForPackage } from "@/lib/integrations/salesforce/resolve-product"
import { syncProductValueSold } from "@/lib/integrations/salesforce/sold-metrics"
import { getSalesforceConnectionStatus } from "@/lib/integrations/salesforce/settings-store"
import { createAdminClient } from "@/lib/supabase/admin"

export type OpportunityOutcome = "booked" | "won" | "lost"

function stageForOutcome(
  outcome: OpportunityOutcome,
  config: NonNullable<ReturnType<typeof getSalesforceConfig>>,
): string {
  switch (outcome) {
    case "won":
      return config.opportunityStageWon
    case "lost":
      return config.opportunityStageLost
    case "booked":
    default:
      return config.opportunityStage
  }
}

/**
 * Aligns Salesforce Opportunity stage with portal payment outcome so DLRS rollups
 * using `Is_Won__c = True` only count paid deals, not open bookings.
 */
export async function syncOpportunityOutcomeForOrder(
  orderId: string,
  outcome: OpportunityOutcome,
): Promise<{ ok: true; opportunityId: string } | { ok: false; message: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role not configured." }

  const status = await getSalesforceConnectionStatus()
  if (!status.connected) return { ok: false, message: "Salesforce not connected." }

  const config = getSalesforceConfig()
  if (!config) return { ok: false, message: "Salesforce not configured." }

  const { data: order, error } = await admin
    .from("orders")
    .select("id, salesforce_opportunity_id, reference, package_id")
    .eq("id", orderId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!order) return { ok: false, message: "Order not found." }

  const opportunityId = order.salesforce_opportunity_id?.trim()
  if (!opportunityId) {
    return {
      ok: false,
      message: `Order ${order.reference} has no Salesforce Opportunity yet. Process the sync queue after placing the order.`,
    }
  }

  const stageName = stageForOutcome(outcome, config)
  try {
    await salesforceRequest("PATCH", `/sobjects/Opportunity/${opportunityId}`, {
      body: { StageName: stageName },
    })
  } catch (e) {
    // Moving to a won stage flips Is_Won__c on the line, which can re-fire the same
    // chained DLRS rollup. Surface a clear message rather than a raw API error.
    return { ok: false, message: formatSalesforceSyncError(e, `Order ${order.reference} → ${stageName}`).message }
  }

  // Stage change (paid / cancelled) affects which lines count toward Value Sold — refresh immediately.
  try {
    const { data: pkg } = await admin
      .from("packages")
      .select("product_code, salesforce_product_id")
      .eq("id", order.package_id)
      .maybeSingle()
    if (pkg) {
      const product2Id = await resolveProduct2IdForPackage({
        productCode: (pkg as { product_code: string | null }).product_code,
        salesforceProductId: (pkg as { salesforce_product_id: string | null }).salesforce_product_id,
      })
      await syncProductValueSold({ product2Id, config })
    }
  } catch (e) {
    console.warn("[salesforce] Value Sold refresh after outcome skipped:", e instanceof Error ? e.message : e)
  }

  return { ok: true, opportunityId }
}
