import { drainIntegrationOutbox } from "@/lib/integrations/drain-outbox"
import { releaseExpiredInventoryHoldsAndSync } from "@/lib/integrations/release-expired-holds"
import { pullInventoryFromSalesforce } from "@/lib/integrations/salesforce/pull-inventory-from-salesforce"

export type IntegrationCronResult = {
  holds: Awaited<ReturnType<typeof releaseExpiredInventoryHoldsAndSync>>
  salesforceInventory: Awaited<ReturnType<typeof pullInventoryFromSalesforce>>
} & Awaited<ReturnType<typeof drainIntegrationOutbox>>

/**
 * Single integration cron tick: expired holds, offline Salesforce sales pull, outbox drain.
 * Used by Vercel cron, local dev scheduler, and admin manual triggers.
 */
export async function runIntegrationCronJob(): Promise<IntegrationCronResult> {
  const holds = await releaseExpiredInventoryHoldsAndSync()

  const salesforceInventory = await pullInventoryFromSalesforce()

  const result = await drainIntegrationOutbox({ maxRounds: 10 })

  return { holds, salesforceInventory, ...result }
}
