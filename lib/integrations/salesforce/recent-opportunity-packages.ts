import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import type { SupabaseClient } from "@supabase/supabase-js"

const RECENT_OPP_LOOKBACK_MS = 2 * 60 * 60 * 1000
const RECENT_OPP_LIMIT = 50

type OpportunityProductRow = {
  Id: string
  LastModifiedDate: string
  OpportunityLineItems?: {
    records: Array<{ Product2Id: string | null }>
  } | null
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function soqlDateTime(d: Date): string {
  return d.toISOString()
}

/**
 * Product2 Ids on opportunities modified recently — **any stage** (open pipeline,
 * Closed Won, Closed Lost). Offline inventory must refresh for all of these:
 * won → sold, open → hold, lost → release.
 */
export async function readRecentlyTouchedOpportunityProduct2Ids(
  lookbackMs: number = RECENT_OPP_LOOKBACK_MS,
  limit: number = RECENT_OPP_LIMIT,
): Promise<{ product2Ids: string[]; opportunitiesScanned: number; errors: string[] }> {
  const since = new Date(Date.now() - lookbackMs)
  const errors: string[] = []
  let rows: OpportunityProductRow[] = []
  try {
    rows = await salesforceQuery<OpportunityProductRow>(
      `SELECT Id, LastModifiedDate, ` +
        `(SELECT Product2Id FROM OpportunityLineItems WHERE Product2Id != null) ` +
        `FROM Opportunity WHERE LastModifiedDate >= ${soqlDateTime(since)} ` +
        `ORDER BY LastModifiedDate DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
    )
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Recent opportunity query failed.")
    return { product2Ids: [], opportunitiesScanned: 0, errors }
  }

  const product2Ids = new Set<string>()
  for (const opp of rows) {
    for (const line of opp.OpportunityLineItems?.records ?? []) {
      const product2Id = typeof line.Product2Id === "string" ? line.Product2Id.trim() : ""
      if (product2Id) product2Ids.add(product2Id)
    }
  }

  return {
    product2Ids: [...product2Ids],
    opportunitiesScanned: rows.length,
    errors,
  }
}

/**
 * Map Salesforce Product2 Ids → portal package ids (linked days + standalone).
 */
export async function resolvePackageIdsForProduct2Ids(
  admin: SupabaseClient,
  product2Ids: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(product2Ids.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return []

  const { data, error } = await admin
    .from("packages")
    .select("id")
    .in("salesforce_product_id", ids)
    .is("shell_parent_package_id", null)
  if (error) throw new Error(error.message)

  return [
    ...new Set(
      (data ?? [])
        .map((r) => (typeof r.id === "string" ? r.id.trim() : ""))
        .filter(Boolean),
    ),
  ]
}

/**
 * Packages whose Salesforce products appear on any recently modified opportunity
 * (open + won + lost). Used so offline inventory sync is not Closed-Won-only.
 */
export async function resolvePackagesTouchedByRecentOpportunities(
  admin: SupabaseClient,
  _config: SalesforceConfig,
  options?: { lookbackMs?: number; limit?: number },
): Promise<{ packageIds: string[]; opportunitiesScanned: number; errors: string[] }> {
  const touched = await readRecentlyTouchedOpportunityProduct2Ids(
    options?.lookbackMs,
    options?.limit,
  )
  if (touched.errors.length > 0 && touched.product2Ids.length === 0) {
    return { packageIds: [], opportunitiesScanned: touched.opportunitiesScanned, errors: touched.errors }
  }

  try {
    const packageIds = await resolvePackageIdsForProduct2Ids(admin, touched.product2Ids)
    return {
      packageIds,
      opportunitiesScanned: touched.opportunitiesScanned,
      errors: touched.errors,
    }
  } catch (e) {
    return {
      packageIds: [],
      opportunitiesScanned: touched.opportunitiesScanned,
      errors: [
        ...touched.errors,
        e instanceof Error ? e.message : "Failed to map recent opportunity products to packages.",
      ],
    }
  }
}
