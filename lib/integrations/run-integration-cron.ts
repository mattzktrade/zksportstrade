import { drainIntegrationOutbox } from "@/lib/integrations/drain-outbox"
import { releaseExpiredInventoryHoldsAndSync } from "@/lib/integrations/release-expired-holds"
import { releaseExpiredDealReservations } from "@/lib/integrations/release-expired-deal-reservations"
import { processNativeBookingForms } from "@/lib/integrations/process-native-booking-forms"
import { processNativeInvoiceReminders } from "@/lib/integrations/process-native-invoice-reminders"
import type { SalesforceInventoryPullResult } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"

const RETIRED_SALESFORCE_PULL: SalesforceInventoryPullResult = {
  skipped: true,
  message: "Salesforce runtime has been retired.",
  closedWon: null,
  checked: 0,
  adjusted: 0,
  skippedPackages: 0,
  adjustments: [],
  channelSyncQueued: 0,
  linkedGroupHeal: null,
  stockSourcesImported: null,
  errors: [],
}

export type IntegrationCronResult = {
  holds: Awaited<ReturnType<typeof releaseExpiredInventoryHoldsAndSync>>
  dealReservations: Awaited<ReturnType<typeof releaseExpiredDealReservations>>
  bookingForms: Awaited<ReturnType<typeof processNativeBookingForms>>
  invoiceReminders: Awaited<ReturnType<typeof processNativeInvoiceReminders>>
  salesforceInventory: SalesforceInventoryPullResult
  staleOpenOpportunities: null
  linkedInventoryHeal: { groups: number; packagesFixed: number } | null
} & Awaited<ReturnType<typeof drainIntegrationOutbox>>

/**
 * Single integration cron tick: expired holds, native booking forms, overdue invoice flags, Wix/Xero outbox.
 * Salesforce pull/heal is retired and never runs.
 */
export async function runIntegrationCronJob(): Promise<IntegrationCronResult> {
  const holds = await releaseExpiredInventoryHoldsAndSync()
  const bookingForms = await processNativeBookingForms()
  const invoiceReminders = await processNativeInvoiceReminders()
  const dealReservations = await releaseExpiredDealReservations()
  const result = await drainIntegrationOutbox({ maxRounds: 10, skipInventoryPull: true })

  return {
    holds,
    bookingForms,
    invoiceReminders,
    dealReservations,
    salesforceInventory: RETIRED_SALESFORCE_PULL,
    staleOpenOpportunities: null,
    linkedInventoryHeal: null,
    ...result,
  }
}
