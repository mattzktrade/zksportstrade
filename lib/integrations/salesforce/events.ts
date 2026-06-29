import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"
import { getProduct2Fields } from "@/lib/integrations/salesforce/describe"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

const EVENT_NAME_BASE_ALIASES: Record<string, string[]> = {
  "Australian Grand Prix": ["Australia Grand Prix"],
  "Austrian Grand Prix": ["Austria Grand Prix"],
  "Belgian Grand Prix": ["Belgium Grand Prix"],
  "British Grand Prix": ["British Grand Prix", "Great Britain Grand Prix", "UK Grand Prix"],
  "Canadian Grand Prix": ["Canada Grand Prix"],
  "Chinese Grand Prix": ["China Grand Prix"],
  "Dutch Grand Prix": ["Netherlands Grand Prix", "Dutch Grand Prix"],
  "Hungarian Grand Prix": ["Hungary Grand Prix"],
  "Italian Grand Prix": ["Italy Grand Prix"],
  "Japanese Grand Prix": ["Japan Grand Prix"],
  "Saudi Arabian Grand Prix": ["Saudi Arabia Grand Prix"],
  "Spanish Grand Prix": ["Spain Grand Prix", "Madrid Grand Prix"],
  "Turkish Grand Prix": ["Turkey Grand Prix", "Türkiye Grand Prix"],
  "United States Grand Prix": ["United States Grand Prix", "US Grand Prix", "USA Grand Prix", "Austin Grand Prix"],
  "São Paulo Grand Prix": ["Sao Paulo Grand Prix", "Brazil Grand Prix", "Brazilian Grand Prix"],
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

function eventNameAliases(raceName: string): string[] {
  const name = raceName.trim()
  if (!name) return []
  const baseAliases = [name, ...(EVENT_NAME_BASE_ALIASES[name] ?? [])]
  const aliases = new Set<string>()

  for (const alias of baseAliases) {
    aliases.add(alias)
    if (/\bGrand Prix\b/i.test(alias)) {
      aliases.add(alias.replace(/\bGrand Prix\b/i, "F1 GP").trim())
      aliases.add(alias.replace(/\bGrand Prix\b/i, "GP").trim())
    }
  }

  return [...aliases].filter(Boolean)
}

/** Returns the Event record Id whose Name matches the race (season + name), or null. */
export async function findEventId(object: string, season: number | null, raceName: string): Promise<string | null> {
  const name = raceName.trim()
  if (!name) return null

  const candidates = eventNameAliases(name).flatMap((alias) =>
    [
      season != null ? `${season} ${alias}` : null,
      season != null ? `${alias} ${season}` : null,
      alias,
    ].filter((v): v is string => Boolean(v)),
  )

  // Exact match first (most reliable), then a contains match on the race name.
  for (const candidate of candidates) {
    const rows = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE Name = '${escapeSoqlString(candidate)}' LIMIT 1`,
    )
    if (rows[0]?.Id) return rows[0].Id
  }

  for (const alias of eventNameAliases(name)) {
    const like = season != null ? `%${alias}%${season}%` : `%${alias}%`
    const fuzzy = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE Name LIKE '${escapeSoqlString(like)}' ORDER BY CreatedDate DESC LIMIT 1`,
    )
    if (fuzzy[0]?.Id) return fuzzy[0].Id
  }

  if (season != null) {
    for (const alias of eventNameAliases(name)) {
      const byNameOnly = await salesforceQuery<{ Id: string }>(
        `SELECT Id FROM ${object} WHERE Name LIKE '%${escapeSoqlString(alias)}%' ORDER BY CreatedDate DESC LIMIT 1`,
      )
      if (byNameOnly[0]?.Id) return byNameOnly[0].Id
    }
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
