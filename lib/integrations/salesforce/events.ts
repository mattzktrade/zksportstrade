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
  "Mexico City Grand Prix": [
    "Mexico City Grand Prix",
    "Mexican Grand Prix",
    "Mexico Grand Prix",
  ],
  "Saudi Arabian Grand Prix": ["Saudi Arabia Grand Prix"],
  "Spanish Grand Prix": ["Spain Grand Prix", "Madrid Grand Prix"],
  "Turkish Grand Prix": ["Turkey Grand Prix", "Türkiye Grand Prix"],
  "United States Grand Prix": ["United States Grand Prix", "US Grand Prix", "USA Grand Prix", "Austin Grand Prix"],
  "Brazilian Grand Prix": [
    "Brazil Grand Prix",
    "São Paulo Grand Prix",
    "Sao Paulo Grand Prix",
  ],
}

export type EventLookup = {
  /** API name of the lookup field on Product2 (e.g. Event_Name__c). */
  field: string
  /** API name of the Event sObject the lookup points to (e.g. Event__c). */
  object: string
}

/** Portal race fields used to find or create a Salesforce Event__c. */
export type RaceEventContext = {
  season: number | null
  raceName: string
  location?: string | null
  shortName?: string | null
  /** Race Sunday / main date as YYYY-MM-DD. */
  eventDate?: string | null
  /** Portal label e.g. "30 Oct - 01 Nov" or "23 - 25 Oct". */
  dateRange?: string | null
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

function eventPlaceLabel(ctx: Pick<RaceEventContext, "raceName" | "location" | "shortName">): string {
  const short = ctx.shortName?.trim()
  if (short) return short
  const loc = ctx.location?.trim()
  if (loc) return loc
  return ctx.raceName.replace(/\bGrand Prix\b/gi, "").replace(/\s+/g, " ").trim() || "Event"
}

/** Salesforce naming style used in this org: "2026 Singapore F1 GP". */
export function preferredSalesforceEventName(ctx: RaceEventContext): string {
  const place = eventPlaceLabel(ctx)
  return ctx.season != null ? `${ctx.season} ${place} F1 GP` : `${place} F1 GP`
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

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Parse portal date_range labels into Start/End dates for Event__c.
 * Supports "30 Oct - 01 Nov", "23 - 25 Oct", "11 - 13 Sep 2026".
 */
export function resolveEventDates(ctx: RaceEventContext): { start: string | null; end: string | null } {
  const endFromRace = ctx.eventDate?.trim() || null
  const range = ctx.dateRange?.trim() || ""
  const season = ctx.season

  if (range && season != null) {
    // "30 Oct - 01 Nov" / "30 October - 1 November"
    const crossMonth = range.match(
      /^(\d{1,2})\s+([A-Za-z]+)\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/i,
    )
    if (crossMonth) {
      const startMonth = MONTHS[crossMonth[2].toLowerCase()]
      const endMonth = MONTHS[crossMonth[4].toLowerCase()]
      const year = crossMonth[5] ? Number(crossMonth[5]) : season
      if (startMonth && endMonth) {
        const startYear = endMonth < startMonth ? year - 1 : year
        return {
          start: ymd(startYear, startMonth, Number(crossMonth[1])),
          end: ymd(year, endMonth, Number(crossMonth[3])),
        }
      }
    }

    // "23 - 25 Oct" / "11-13 Sep"
    const sameMonth = range.match(
      /^(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/i,
    )
    if (sameMonth) {
      const month = MONTHS[sameMonth[3].toLowerCase()]
      const year = sameMonth[4] ? Number(sameMonth[4]) : season
      if (month) {
        return {
          start: ymd(year, month, Number(sameMonth[1])),
          end: ymd(year, month, Number(sameMonth[2])),
        }
      }
    }
  }

  if (endFromRace) {
    const end = new Date(`${endFromRace}T12:00:00Z`)
    if (!Number.isNaN(end.getTime())) {
      const start = new Date(end)
      start.setUTCDate(start.getUTCDate() - 2)
      return { start: start.toISOString().slice(0, 10), end: endFromRace }
    }
  }

  return { start: null, end: endFromRace }
}

/** Returns the Event record Id whose Name matches the race (season + name), or null. */
export async function findEventId(object: string, season: number | null, raceName: string): Promise<string | null> {
  const name = raceName.trim()
  if (!name) return null

  const candidates = eventNameAliases(name).flatMap((alias) =>
    [
      season != null ? `${season} ${alias}` : null,
      season != null ? `${alias} ${season}` : null,
      // Org convention: "2026 Singapore F1 GP"
      season != null && /\bGrand Prix\b/i.test(alias)
        ? `${season} ${alias.replace(/\bGrand Prix\b/i, "F1 GP").trim()}`
        : null,
      season != null && /\bGrand Prix\b/i.test(alias)
        ? `${season} ${alias.replace(/\bCity Grand Prix\b/i, "").replace(/\bGrand Prix\b/i, "").trim()} F1 GP`
        : null,
      season == null ? alias : null,
    ].filter((v): v is string => Boolean(v)),
  )

  // Exact match first (most reliable), then a contains match that still requires the season.
  for (const candidate of [...new Set(candidates)]) {
    const rows = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM ${object} WHERE Name = '${escapeSoqlString(candidate)}' LIMIT 1`,
    )
    if (rows[0]?.Id) return rows[0].Id
  }

  for (const alias of eventNameAliases(name)) {
    const like =
      season != null
        ? `%${escapeSoqlString(String(season))}%${escapeSoqlString(alias)}%`
        : `%${escapeSoqlString(alias)}%`
    // Also try alias-then-season order used by some older names.
    const likes =
      season != null
        ? [
            like,
            `%${escapeSoqlString(alias)}%${escapeSoqlString(String(season))}%`,
            `%${escapeSoqlString(String(season))}%${escapeSoqlString(alias.replace(/\bGrand Prix\b/i, "F1 GP").trim())}%`,
          ]
        : [like]

    for (const pattern of [...new Set(likes)]) {
      const fuzzy = await salesforceQuery<{ Id: string }>(
        `SELECT Id FROM ${object} WHERE Name LIKE '${pattern}' ORDER BY CreatedDate DESC LIMIT 1`,
      )
      if (fuzzy[0]?.Id) return fuzzy[0].Id
    }
  }

  // Do NOT fall back to name-only without season — that links 2026 packages to older
  // events (or unrelated House 44 products on another GP) and causes false conflicts.

  return null
}

/**
 * Find an existing Salesforce Event for this race, or create one using the org naming
 * convention ("2026 Mexico F1 GP") and portal race dates/location.
 */
export async function ensureEventId(
  object: string,
  ctx: RaceEventContext,
): Promise<{ eventId: string; created: boolean }> {
  const existing = await findEventId(object, ctx.season, ctx.raceName)
  if (existing) return { eventId: existing, created: false }

  const preferred = preferredSalesforceEventName(ctx)
  const preferredHit = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM ${object} WHERE Name = '${escapeSoqlString(preferred)}' LIMIT 1`,
  )
  if (preferredHit[0]?.Id) return { eventId: preferredHit[0].Id, created: false }

  const { start, end } = resolveEventDates(ctx)
  const body: Record<string, unknown> = {
    Name: preferred,
  }
  if (start) body.Start_Date__c = start
  if (end) body.End_Date__c = end
  const location = ctx.location?.trim() || ctx.shortName?.trim() || null
  if (location) body.Location__c = location

  const created = await salesforceRequest<{ id: string; success?: boolean }>("POST", `/sobjects/${object}`, {
    body,
  })
  const id = typeof created.id === "string" ? created.id : ""
  if (!id) {
    throw new Error(`Salesforce created ${object} but returned no Id for "${preferred}".`)
  }
  return { eventId: id, created: true }
}

/**
 * Links a Product2 to its Event record so Salesforce shows which event the product is for.
 * Creates the Event when missing. Best-effort: returns status for the sync report; never throws.
 */
export async function linkProductToEvent(args: {
  product2Id: string
  config: SalesforceConfig
  season: number | null
  raceName: string
  location?: string | null
  shortName?: string | null
  eventDate?: string | null
  dateRange?: string | null
}): Promise<{ ok: true; field: string; createdEvent?: boolean } | { ok: false; message: string }> {
  try {
    const lookup = await resolveEventLookup(args.config)
    if (!lookup) {
      return {
        ok: false,
        message:
          "Event field not found on Product (set SALESFORCE_FIELD_EVENT in .env.local to the Event lookup API name).",
      }
    }

    const ensured = await ensureEventId(lookup.object, {
      season: args.season,
      raceName: args.raceName,
      location: args.location,
      shortName: args.shortName,
      eventDate: args.eventDate,
      dateRange: args.dateRange,
    })

    await salesforceRequest("PATCH", `/sobjects/Product2/${args.product2Id}`, {
      body: { [lookup.field]: ensured.eventId },
    })
    return { ok: true, field: lookup.field, createdEvent: ensured.created }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
