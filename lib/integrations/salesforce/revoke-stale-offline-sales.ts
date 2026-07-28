import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import type { SupabaseClient } from "@supabase/supabase-js"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export type RevokeStaleOfflineSalesResult = {
  opportunitiesChecked: number
  revokedRows: number
  revokedOpportunityIds: string[]
  affectedPackageIds: string[]
  errors: string[]
}

type OpportunityWonRow = {
  Id: string
  IsWon: boolean | null
  StageName: string | null
}

function isStillClosedWon(
  row: OpportunityWonRow,
  wonStageName: string,
): boolean {
  if (row.IsWon === true) return true
  const stage = typeof row.StageName === "string" ? row.StageName.trim() : ""
  const won = wonStageName.trim()
  return Boolean(won && stage && stage === won)
}

/**
 * Remove `salesforce_offline_sale_applications` rows for opportunities that are no longer
 * Closed Won (Closed Lost, cancelled, reopened, etc.).
 *
 * Offline apps are insert-only when deals win; without revoke, heal + Stock Source sync keep
 * treating Lost units as sold forever (portal sellable 0, SF Quantity Sold = Stock).
 */
export async function revokeStaleOfflineSaleApplications(
  admin: SupabaseClient,
  config: SalesforceConfig,
  options?: {
    /** When set, only consider these opportunity Ids (e.g. recently modified). */
    opportunityIds?: readonly string[]
    /** Check every opportunity Id present in the offline applications table. */
    checkAllApplied?: boolean
  },
): Promise<RevokeStaleOfflineSalesResult> {
  const result: RevokeStaleOfflineSalesResult = {
    opportunitiesChecked: 0,
    revokedRows: 0,
    revokedOpportunityIds: [],
    affectedPackageIds: [],
    errors: [],
  }

  let candidateOppIds: string[] = []
  if (options?.checkAllApplied) {
    const { data, error } = await admin
      .from("salesforce_offline_sale_applications")
      .select("salesforce_opportunity_id")
    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01") {
        return result
      }
      result.errors.push(error.message)
      return result
    }
    candidateOppIds = [
      ...new Set(
        (data ?? [])
          .map((r) =>
            typeof r.salesforce_opportunity_id === "string"
              ? r.salesforce_opportunity_id.trim()
              : "",
          )
          .filter(Boolean),
      ),
    ]
  } else {
    candidateOppIds = [
      ...new Set(
        (options?.opportunityIds ?? [])
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ]
    if (candidateOppIds.length === 0) return result

    // Only opps that actually have offline application rows.
    const { data, error } = await admin
      .from("salesforce_offline_sale_applications")
      .select("salesforce_opportunity_id")
      .in("salesforce_opportunity_id", candidateOppIds)
    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01") {
        return result
      }
      result.errors.push(error.message)
      return result
    }
    candidateOppIds = [
      ...new Set(
        (data ?? [])
          .map((r) =>
            typeof r.salesforce_opportunity_id === "string"
              ? r.salesforce_opportunity_id.trim()
              : "",
          )
          .filter(Boolean),
      ),
    ]
  }

  if (candidateOppIds.length === 0) return result

  const wonStage = config.opportunityStageWon.trim() || "Closed Won"
  const stillWon = new Set<string>()

  for (let i = 0; i < candidateOppIds.length; i += 100) {
    const batch = candidateOppIds.slice(i, i + 100)
    const inList = batch.map((id) => `'${escapeSoqlString(id)}'`).join(",")
    try {
      const rows = await salesforceQuery<OpportunityWonRow>(
        `SELECT Id, IsWon, StageName FROM Opportunity WHERE Id IN (${inList})`,
      )
      result.opportunitiesChecked += rows.length
      for (const row of rows) {
        const id = typeof row.Id === "string" ? row.Id.trim() : ""
        if (!id) continue
        if (isStillClosedWon(row, wonStage)) stillWon.add(id)
      }
    } catch (e) {
      result.errors.push(
        e instanceof Error ? e.message : "Failed to verify Closed Won status for offline sales.",
      )
      return result
    }
  }

  // Revoke when SF says not won, or the opportunity no longer exists in SF.
  const toRevoke = candidateOppIds.filter((id) => !stillWon.has(id))
  if (toRevoke.length === 0) return result

  const { data: doomed, error: selectErr } = await admin
    .from("salesforce_offline_sale_applications")
    .select("id, package_id, salesforce_opportunity_id")
    .in("salesforce_opportunity_id", toRevoke)

  if (selectErr) {
    result.errors.push(selectErr.message)
    return result
  }

  const rowIds = (doomed ?? []).map((r) => String(r.id))
  const packageIds = new Set<string>()
  const oppIds = new Set<string>()
  for (const row of doomed ?? []) {
    const pkg =
      typeof row.package_id === "string" ? row.package_id.trim() : ""
    const opp =
      typeof row.salesforce_opportunity_id === "string"
        ? row.salesforce_opportunity_id.trim()
        : ""
    if (pkg) packageIds.add(pkg)
    if (opp) oppIds.add(opp)
  }

  if (rowIds.length === 0) return result

  const { error: deleteErr } = await admin
    .from("salesforce_offline_sale_applications")
    .delete()
    .in("id", rowIds)

  if (deleteErr) {
    result.errors.push(deleteErr.message)
    return result
  }

  result.revokedRows = rowIds.length
  result.revokedOpportunityIds = [...oppIds]
  result.affectedPackageIds = [...packageIds]
  return result
}

/**
 * Opportunity Ids modified recently (any stage) — used to revoke Lost/cancelled offline apps
 * without scanning the whole offline applications table on every cron tick.
 */
export async function readRecentlyModifiedOpportunityIds(
  lookbackMs: number,
  limit: number = 100,
): Promise<{ opportunityIds: string[]; errors: string[] }> {
  const since = new Date(Date.now() - Math.max(60_000, lookbackMs))
  const errors: string[] = []
  try {
    const rows = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM Opportunity WHERE LastModifiedDate >= ${since.toISOString()} ` +
        `ORDER BY LastModifiedDate DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
    )
    return {
      opportunityIds: [
        ...new Set(
          rows
            .map((r) => (typeof r.Id === "string" ? r.Id.trim() : ""))
            .filter(Boolean),
        ),
      ],
      errors,
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Recent opportunity Id query failed.")
    return { opportunityIds: [], errors }
  }
}
