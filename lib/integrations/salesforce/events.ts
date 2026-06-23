import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { getProduct2Fields } from "@/lib/integrations/salesforce/describe"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export type EventLookup = {
  /** API name of the lookup field on Product2 (e.g. Event_Name__c). */
  field: string
  /** API name of the Event sObject the lookup points to (e.g. Event__c). */
  object: string
}

/**
 * Find the Product2 lookup field that points to the org's Event object.
 * Prefers the explicit env override (SALESFORCE_FIELD_EVENT); otherwise auto-detects a
 * custom, updateable reference field labelled like "Event".
 */
export async function resolveEventLookup(config: SalesforceConfig): Promise<EventLookup | null> {
  const fields = await getProduct2Fields()

  if (config.fieldEvent) {
    const explicit = fields.find((f) => f.name === config.fieldEvent)
    if (explicit && explicit.type === "reference" && explicit.referenceTo?.length) {
      return { field: explicit.name, object: explicit.referenceTo[0] }
    }
    // Env name not a usable lookup — fall through to auto-detection rather than failing.
  }

  const candidate = fields.find(
    (f) =>
      f.type === "reference" &&
      f.updateable &&
      !f.calculated &&
      (f.referenceTo?.length ?? 0) > 0 &&
      /event/i.test(f.label),
  )
  if (!candidate) return null
  return { field: candidate.name, object: candidate.referenceTo![0] }
}

/** Returns the Event record Id whose Name matches the race (season + name), or null. */
async function findEventId(object: string, season: number | null, raceName: string): Promise<string | null> {
  const name = raceName.trim()
  if (!name) return null

  const candidates = [
    season != null ? `${season} ${name}` : null,
    season != null ? `${name} ${season}` : null,
    name,
  ].filter((v): v is string => Boolean(v))

  // Exact match first (most reliable), then a contains match on the race name.
  for (const candidate of candidates) {
    const rows = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE Name = '${escapeSoqlString(candidate)}' LIMIT 1`,
    )
    if (rows[0]?.Id) return rows[0].Id
  }

  const like = season != null ? `%${name}%${season}%` : `%${name}%`
  const fuzzy = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM ${object} WHERE Name LIKE '${escapeSoqlString(like)}' ORDER BY CreatedDate DESC LIMIT 1`,
  )
  if (fuzzy[0]?.Id) return fuzzy[0].Id

  if (season != null) {
    const byNameOnly = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE Name LIKE '%${escapeSoqlString(name)}%' ORDER BY CreatedDate DESC LIMIT 1`,
    )
    if (byNameOnly[0]?.Id) return byNameOnly[0].Id
  }

  return null
}

/**
 * Links a Product2 to its Event record so Salesforce shows which event the product is for.
 * Best-effort: returns a status string for the sync report; never throws (won't block product sync).
 */
export async function linkProductToEvent(args: {
  product2Id: string
  config: SalesforceConfig
  season: number | null
  raceName: string
}): Promise<{ ok: true; field: string } | { ok: false; message: string }> {
  try {
    const lookup = await resolveEventLookup(args.config)
    if (!lookup) {
      return {
        ok: false,
        message:
          "Event field not found on Product (set SALESFORCE_FIELD_EVENT in .env.local to the Event lookup API name).",
      }
    }

    const eventId = await findEventId(lookup.object, args.season, args.raceName)
    if (!eventId) {
      const label = args.season != null ? `${args.season} ${args.raceName}` : args.raceName
      return {
        ok: false,
        message: `No Salesforce ${lookup.object} record found matching "${label}". Create the event in Salesforce, then re-sync.`,
      }
    }

    await salesforceRequest("PATCH", `/sobjects/Product2/${args.product2Id}`, {
      body: { [lookup.field]: eventId },
    })
    return { ok: true, field: lookup.field }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
