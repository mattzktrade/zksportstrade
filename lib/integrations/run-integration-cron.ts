import { drainIntegrationOutbox } from "@/lib/integrations/drain-outbox"
import { refreshXeroOrgDefaultsBestEffort } from "@/lib/integrations/xero/invoice-line-defaults"
import { releaseExpiredInventoryHoldsAndSync } from "@/lib/integrations/release-expired-holds"
import { releaseExpiredDealReservations } from "@/lib/integrations/release-expired-deal-reservations"
import { processNativeBookingForms } from "@/lib/integrations/process-native-booking-forms"
import { processInstallmentInvoiceCreates } from "@/lib/integrations/process-installment-invoices"
import { processNativeInvoiceReminders } from "@/lib/integrations/process-native-invoice-reminders"
import { processMarketingOutreach } from "@/lib/integrations/marketing-leads/outreach-process"
import { processDecidingFollowUps } from "@/lib/integrations/marketing-leads/follow-up-process"
import { processSalesDigest } from "@/lib/crm/sales-digest-process"
import { processAssistantInbox } from "@/lib/assistant/process"
import { expirePastEventEnquiries } from "@/lib/crm/expire-past-event-enquiries"
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
  installmentInvoices: Awaited<ReturnType<typeof processInstallmentInvoiceCreates>>
  invoiceReminders: Awaited<ReturnType<typeof processNativeInvoiceReminders>>
  salesforceInventory: SalesforceInventoryPullResult
  staleOpenOpportunities: null
  linkedInventoryHeal: { groups: number; packagesFixed: number } | null
  marketingOutreach: Awaited<ReturnType<typeof processMarketingOutreach>>
  decidingFollowUps: Awaited<ReturnType<typeof processDecidingFollowUps>>
  salesDigest: Awaited<ReturnType<typeof processSalesDigest>>
  expiredEnquiries: Awaited<ReturnType<typeof expirePastEventEnquiries>>
  assistantInbox: Awaited<ReturnType<typeof processAssistantInbox>>
} & Awaited<ReturnType<typeof drainIntegrationOutbox>>

/**
 * Single integration cron tick: expired holds, native booking forms, Wix/Xero outbox, then overdue invoice flags.
 * Invoice creation runs before overdue Xero reconciliation so new deals are not starved by the 60/min cap.
 * New invoice.create jobs are also drained before other outbox work (catalog / Salesforce).
 * Salesforce pull/heal is retired and never runs.
 */
export async function runIntegrationCronJob(): Promise<IntegrationCronResult> {
  const holds = await releaseExpiredInventoryHoldsAndSync()
  const bookingForms = await processNativeBookingForms()
  const dealReservations = await releaseExpiredDealReservations()
  const installmentInvoices = await processInstallmentInvoiceCreates()
  const result = await drainIntegrationOutbox({ maxRounds: 10, skipInventoryPull: true })
  const invoiceReminders = await processNativeInvoiceReminders()
  try {
    await refreshXeroOrgDefaultsBestEffort()
  } catch (error) {
    console.warn(
      "[xero] Org defaults refresh skipped:",
      error instanceof Error ? error.message : error,
    )
  }
  let expiredEnquiries: Awaited<ReturnType<typeof expirePastEventEnquiries>> = {
    deals: 0,
    packagesSynced: [],
  }
  try {
    expiredEnquiries = await expirePastEventEnquiries()
  } catch (error) {
    console.error(
      "[enquiry-expiry]",
      error instanceof Error ? error.message : "Enquiry expiry failed.",
    )
  }
  let marketingOutreach: Awaited<ReturnType<typeof processMarketingOutreach>> = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  }
  try {
    marketingOutreach = await processMarketingOutreach()
  } catch (error) {
    marketingOutreach = {
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 1,
      message: error instanceof Error ? error.message : "Marketing outreach failed.",
    }
  }

  let decidingFollowUps: Awaited<ReturnType<typeof processDecidingFollowUps>> = {
    moved: 0,
    reminded: 0,
    closed: 0,
    failed: 0,
  }
  try {
    decidingFollowUps = await processDecidingFollowUps()
  } catch (error) {
    decidingFollowUps = { moved: 0, reminded: 0, closed: 0, failed: 1 }
    console.error("[deciding-follow-up]", error instanceof Error ? error.message : "Deciding follow-ups failed.")
  }

  let salesDigest: Awaited<ReturnType<typeof processSalesDigest>> = { sent: 0, skipped: 0, failed: 0 }
  try {
    salesDigest = await processSalesDigest()
  } catch (error) {
    salesDigest = { sent: 0, skipped: 0, failed: 1 }
    console.error("[sales-digest]", error instanceof Error ? error.message : "Sales digest failed.")
  }

  let assistantInbox: Awaited<ReturnType<typeof processAssistantInbox>> = {
    processed: 0,
    sent: 0,
    drafted: 0,
    escalated: 0,
    failed: 0,
  }
  try {
    assistantInbox = await processAssistantInbox()
  } catch (error) {
    assistantInbox = {
      processed: 0,
      sent: 0,
      drafted: 0,
      escalated: 0,
      failed: 1,
    }
    console.error("[assistant]", error instanceof Error ? error.message : "Assistant inbox failed.")
  }

  return {
    holds,
    bookingForms,
    installmentInvoices,
    invoiceReminders,
    dealReservations,
    salesforceInventory: RETIRED_SALESFORCE_PULL,
    staleOpenOpportunities: null,
    linkedInventoryHeal: null,
    ...result,
    marketingOutreach,
    decidingFollowUps,
    salesDigest,
    expiredEnquiries,
    assistantInbox,
  }
}
