import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import type { SupabaseClient } from "@supabase/supabase-js"

const DEFAULT_MAX_AGE_DAYS = 14

export type ExpireStaleOpenOpportunitiesResult = {
  scanned: number
  expired: number
  skippedPortalOrders: number
  errors: string[]
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function soqlDateTime(d: Date): string {
  return d.toISOString()
}

async function loadPortalOpportunityIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from("orders")
    .select("salesforce_opportunity_id")
    .not("salesforce_opportunity_id", "is", null)

  if (error) throw new Error(error.message)

  const ids = new Set<string>()
  for (const row of data ?? []) {
    const id = typeof row.salesforce_opportunity_id === "string" ? row.salesforce_opportunity_id.trim() : ""
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Move stale open Salesforce opportunities to Closed Lost so reserved stock is released.
 * Portal-created opportunities are never expired — checkout holds use portal inventory holds.
 *
 * Disabled by default. Set `SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES=1` to enable in cron.
 */
export async function expireStaleOpenOpportunities(
  admin: SupabaseClient,
  config: SalesforceConfig,
  options?: { maxAgeDays?: number },
): Promise<ExpireStaleOpenOpportunitiesResult> {
  const result: ExpireStaleOpenOpportunitiesResult = {
    scanned: 0,
    expired: 0,
    skippedPortalOrders: 0,
    errors: [],
  }

  const envDays = Number(process.env.SALESFORCE_OPEN_OPPORTUNITY_EXPIRY_DAYS)
  const maxAgeDays =
    options?.maxAgeDays ??
    (Number.isFinite(envDays) && envDays > 0 ? Math.floor(envDays) : DEFAULT_MAX_AGE_DAYS)

  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
  const lostStage = escapeSoqlString(config.opportunityStageLost.trim())

  let portalOppIds: Set<string>
  try {
    portalOppIds = await loadPortalOpportunityIds(admin)
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Failed to load portal opportunity ids.")
    return result
  }

  const soql = `SELECT Id, Name, CreatedDate FROM Opportunity WHERE IsClosed = false AND IsWon = false AND StageName != '${lostStage}' AND CreatedDate < ${soqlDateTime(cutoff)} ORDER BY CreatedDate ASC LIMIT 200`

  let rows: Array<{ Id: string; Name: string; CreatedDate: string }>
  try {
    rows = await salesforceQuery<{ Id: string; Name: string; CreatedDate: string }>(soql)
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Stale open opportunity query failed.")
    return result
  }

  for (const row of rows) {
    result.scanned++
    const oppId = typeof row.Id === "string" ? row.Id.trim() : ""
    if (!oppId) continue

    if (portalOppIds.has(oppId)) {
      result.skippedPortalOrders++
      continue
    }

    try {
      await salesforceRequest("PATCH", `/sobjects/Opportunity/${oppId}`, {
        body: { StageName: config.opportunityStageLost },
      })
      result.expired++
    } catch (e) {
      const name = typeof row.Name === "string" ? row.Name : oppId
      result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}
