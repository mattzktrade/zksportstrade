import { drainIntegrationOutbox } from "@/lib/integrations/drain-outbox"
import { releaseExpiredInventoryHoldsAndSync } from "@/lib/integrations/release-expired-holds"
import { releaseExpiredDealReservations } from "@/lib/integrations/release-expired-deal-reservations"
import { processNativeBookingForms } from "@/lib/integrations/process-native-booking-forms"
import { processNativeInvoiceReminders } from "@/lib/integrations/process-native-invoice-reminders"
import { expireStaleOpenOpportunities } from "@/lib/integrations/salesforce/expire-stale-open-opportunities"
import { pullInventoryFromSalesforce } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"
import { isSalesforceConfigured, getSalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getStoredInstanceUrl } from "@/lib/integrations/salesforce/settings-store"
import { repairAllDriftedLinkedGroupsFromSalesforce } from "@/lib/inventory/linked-group-inventory"
import { createAdminClient } from "@/lib/supabase/admin"

export type IntegrationCronResult = {
  holds: Awaited<ReturnType<typeof releaseExpiredInventoryHoldsAndSync>>
  dealReservations: Awaited<ReturnType<typeof releaseExpiredDealReservations>>
  bookingForms: Awaited<ReturnType<typeof processNativeBookingForms>>
  invoiceReminders: Awaited<ReturnType<typeof processNativeInvoiceReminders>>
  salesforceInventory: Awaited<ReturnType<typeof pullInventoryFromSalesforce>>
  staleOpenOpportunities: Awaited<ReturnType<typeof expireStaleOpenOpportunities>> | null
  linkedInventoryHeal: { groups: number; packagesFixed: number } | null
} & Awaited<ReturnType<typeof drainIntegrationOutbox>>

/**
 * Single integration cron tick: expired holds, offline Salesforce sales pull, outbox drain.
 * Used by Vercel cron, local dev scheduler, and admin manual triggers.
 */
export async function runIntegrationCronJob(): Promise<IntegrationCronResult> {
  const holds = await releaseExpiredInventoryHoldsAndSync()
  const bookingForms = await processNativeBookingForms()
  const invoiceReminders = await processNativeInvoiceReminders()
  const dealReservations = await releaseExpiredDealReservations()

  const salesforceInventory = await pullInventoryFromSalesforce()

  let staleOpenOpportunities: Awaited<ReturnType<typeof expireStaleOpenOpportunities>> | null = null
  const expireStaleEnabled =
    process.env.SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES === "1" ||
    process.env.SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES === "true"
  if (expireStaleEnabled && isSalesforceConfigured()) {
    const admin = createAdminClient()
    const instanceUrl =
      (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
    const config = getSalesforceConfig(instanceUrl || undefined)
    if (admin && config) {
      try {
        staleOpenOpportunities = await expireStaleOpenOpportunities(admin, config)
      } catch (e) {
        console.warn(
          "[integration-cron] stale open opportunity expiry failed:",
          e instanceof Error ? e.message : e,
        )
      }
    }
  }

  const result = await drainIntegrationOutbox({ maxRounds: 10, skipInventoryPull: true })

  // pullInventoryFromSalesforce already runs syncStaleLinkedGroupsFromSalesforce. Only fall
  // back to repairAllDrifted when the pull never reached that step (null heal result).
  if (isSalesforceConfigured() && salesforceInventory.linkedGroupHeal == null) {
    const admin = createAdminClient()
    const instanceUrl =
      (await getStoredInstanceUrl()) ?? process.env.SALESFORCE_INSTANCE_URL?.trim() ?? ""
    const config = getSalesforceConfig(instanceUrl || undefined)
    if (admin && config) {
      try {
        await repairAllDriftedLinkedGroupsFromSalesforce(admin, config)
      } catch (e) {
        console.warn(
          "[integration-cron] linked drift repair failed:",
          e instanceof Error ? e.message : e,
        )
      }
    }
  }

  return {
    holds,
    bookingForms,
    invoiceReminders,
    dealReservations,
    salesforceInventory,
    staleOpenOpportunities,
    linkedInventoryHeal: salesforceInventory.linkedGroupHeal,
    ...result,
  }
}
