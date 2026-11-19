"use server"

import { revalidatePath } from "next/cache"
import { requireAdminAction } from "@/app/(admin)/actions"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  ENQUIRY_EVENT_CATEGORIES,
  isEnquiryEventCategory,
  isEventCategory,
  type EventCategory,
} from "@/lib/catalog/event-categories"
import { resolveCountryInput } from "@/lib/catalog/countries"
import {
  enquiryEventShortName,
  formatEnquiryEventDateRange,
  nativeEventId,
  seasonFromEventDate,
} from "@/lib/catalog/event-id"
import {
  catalogMatchMessage,
  findEventCatalogMatches,
  findProductCatalogMatches,
  type CatalogEventCandidate,
  type CatalogProductCandidate,
  type EventCatalogMatch,
  type ProductCatalogMatch,
} from "@/lib/catalog/enquiry-catalog-match"
import { generatePackageIdFromRaceAndName } from "@/lib/catalog/generate-package-id"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { inferPackageDurationFromName, isValidPackageDuration } from "@/lib/catalog/package-duration"
import { isPaddockClubPackageName } from "@/lib/catalog/paddock-club"
import {
  isMissingRaceCircuitColumnError,
  packageEventDefaultsFromRace,
} from "@/lib/catalog/race-circuit"

type DbClient = Awaited<ReturnType<typeof requireAdminAction>> extends infer T
  ? T extends { ok: true; supabase: infer S }
    ? S
    : never
  : never

export type EnquiryEventDraft = {
  category: EventCategory
  name: string
  circuit: string
  location: string
  country: string
  countryCode?: string
  eventDate: string
  season?: number
}

export type EnquiryCreatedEvent = {
  id: string
  label: string
  eventDate: string | null
  category: string | null
  isArchived: boolean
}

export type EnquiryCreatedProduct = {
  id: string
  label: string
  eventId: string
  eventName: string
  packageName: string
  price: number | null
  currency: string
  stockLeft: number
}

const RACE_SELECT =
  "id, name, short_name, circuit, location, country, country_code, event_date, date_range, image, season, category, is_archived"
const RACE_SELECT_NO_CIRCUIT =
  "id, name, short_name, location, country, country_code, event_date, date_range, image, season, category, is_archived"

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(error?.message ?? "")
}

function toEventOption(row: {
  id: string
  name: string
  season?: number | null
  event_date?: string | null
  category?: string | null
  is_archived?: boolean | null
}): EnquiryCreatedEvent {
  return {
    id: row.id,
    label: eventSeasonLabel(row.name, row.season ?? null),
    eventDate: row.event_date ? String(row.event_date).slice(0, 10) : null,
    category: row.category ?? null,
    isArchived: Boolean(row.is_archived),
  }
}

function toProductOption(
  pkg: { id: string; name: string; currency?: string | null },
  event: { id: string; name: string; season?: number | null },
): EnquiryCreatedProduct {
  const eventName = eventSeasonLabel(event.name, event.season ?? null)
  return {
    id: pkg.id,
    label: `${eventName} — ${pkg.name}`,
    eventId: event.id,
    eventName,
    packageName: pkg.name,
    price: null,
    currency: pkg.currency || "USD",
    stockLeft: 0,
  }
}

async function catalogWriteClient(user: DbClient) {
  return createAdminClient() ?? user
}

async function loadRaces(db: DbClient): Promise<CatalogEventCandidate[]> {
  const first = await db.from("races").select(RACE_SELECT)
  const result =
    first.error && isMissingRaceCircuitColumnError(first.error.message)
      ? await db.from("races").select(RACE_SELECT_NO_CIRCUIT)
      : first
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    shortName: row.short_name ?? null,
    season: typeof row.season === "number" ? row.season : Number(row.season) || null,
    circuit: (row as { circuit?: string | null }).circuit ?? null,
    location: row.location ?? null,
    eventDate: row.event_date ? String(row.event_date).slice(0, 10) : null,
    isArchived: Boolean(row.is_archived),
    category: row.category ?? null,
  }))
}

async function loadRace(db: DbClient, raceId: string) {
  const first = await db.from("races").select(RACE_SELECT).eq("id", raceId).maybeSingle()
  if (first.error && isMissingRaceCircuitColumnError(first.error.message)) {
    const retry = await db.from("races").select(RACE_SELECT_NO_CIRCUIT).eq("id", raceId).maybeSingle()
    if (retry.error) return { error: retry.error, data: null }
    return {
      error: null,
      data: retry.data ? { ...retry.data, circuit: null as string | null } : null,
    }
  }
  return first
}

async function loadProductsForRace(db: DbClient, raceId: string): Promise<CatalogProductCandidate[]> {
  const { data, error } = await db
    .from("packages")
    .select("id, name, duration, shell_parent_package_id, race_id")
    .eq("race_id", raceId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    raceId: String(row.race_id),
    name: String(row.name ?? ""),
    duration: (row.duration as string | null) ?? null,
    shellParentPackageId: (row.shell_parent_package_id as string | null) ?? null,
  }))
}

function parseEventDraft(input: EnquiryEventDraft):
  | { ok: true; value: Required<Pick<EnquiryEventDraft, "category" | "name" | "circuit" | "location" | "country" | "eventDate">> & { countryCode: string; season: number; shortName: string; dateRange: string; id: string } }
  | { ok: false; message: string } {
  const category = input.category
  if (!isEventCategory(category)) return { ok: false, message: "Select a valid event category." }
  if (!isEnquiryEventCategory(category)) {
    return { ok: false, message: "Create a Formula 1 race in Inventory → Events. From an enquiry you can add any other category." }
  }
  const name = input.name.trim()
  const circuit = input.circuit.trim()
  const location = input.location.trim()
  const eventDate = input.eventDate.trim().slice(0, 10)
  const country = resolveCountryInput(input.country, input.countryCode)
  const season = Math.floor(Number(input.season) || seasonFromEventDate(eventDate))
  if (!name) return { ok: false, message: "Enter the event name." }
  if (!circuit) return { ok: false, message: "Enter the venue." }
  if (!location) return { ok: false, message: "Enter the city or location." }
  if (!country) return { ok: false, message: "Choose a country." }
  if (!eventDate || Number.isNaN(new Date(`${eventDate}T00:00:00Z`).getTime())) {
    return { ok: false, message: "Enter a valid event date." }
  }
  if (!Number.isFinite(season) || season < 2020 || season > 2100) {
    return { ok: false, message: "Season must be a valid four-digit year." }
  }
  const id = nativeEventId(name, season)
  if (!id || id.length < 3) return { ok: false, message: "Could not generate a valid event ID." }
  return {
    ok: true,
    value: {
      category,
      name,
      circuit,
      location,
      country: country.name,
      countryCode: country.code,
      eventDate,
      season,
      shortName: enquiryEventShortName(name, season),
      dateRange: formatEnquiryEventDateRange(eventDate),
      id,
    },
  }
}

function revalidateEnquiryCatalog(raceId?: string) {
  revalidatePath("/admin/enquiries")
  revalidatePath("/admin/deals")
  revalidatePath("/admin/catalog")
  revalidatePath("/admin/catalog/events")
  revalidatePath("/admin/inventory/sales-list")
  if (raceId?.trim()) {
    revalidatePath(`/admin/catalog/events/${encodeURIComponent(raceId.trim())}`)
  }
}

async function unarchiveIfNeeded(db: Awaited<ReturnType<typeof catalogWriteClient>>, raceId: string, archived: boolean) {
  if (!archived) return
  const { error } = await db
    .from("races")
    .update({ is_archived: false, updated_at: new Date().toISOString() })
    .eq("id", raceId)
  if (error) throw new Error(error.message)
}

async function insertEvent(
  db: Awaited<ReturnType<typeof catalogWriteClient>>,
  value: Extract<ReturnType<typeof parseEventDraft>, { ok: true }>["value"],
) {
  const insertRow = {
    id: value.id,
    category: value.category,
    name: value.name,
    short_name: value.shortName,
    circuit: value.circuit,
    location: value.location,
    country: value.country,
    country_code: value.countryCode,
    event_date: value.eventDate,
    date_range: value.dateRange,
    image: "/placeholder.svg",
    season: value.season,
    is_archived: false,
    updated_at: new Date().toISOString(),
  }
  let { error } = await db.from("races").insert(insertRow)
  if (error && isMissingRaceCircuitColumnError(error.message)) {
    const { circuit: _circuit, ...withoutCircuit } = insertRow
    const retry = await db.from("races").insert(withoutCircuit)
    error = retry.error
  }
  return error
}

export async function previewEnquiryCatalogEvent(input: EnquiryEventDraft): Promise<{
  ok: true
  matches: EventCatalogMatch[]
} | { ok: false; message: string }> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const parsed = parseEventDraft(input)
  if (!parsed.ok) return { ok: true, matches: [] }
  try {
    const races = await loadRaces(gate.supabase)
    return {
      ok: true,
      matches: findEventCatalogMatches(
        {
          name: parsed.value.name,
          season: parsed.value.season,
          circuit: parsed.value.circuit,
          eventDate: parsed.value.eventDate,
        },
        races,
      ),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not search events." }
  }
}

export async function previewEnquiryCatalogProduct(input: {
  raceId: string
  name: string
  duration?: string | null
}): Promise<{ ok: true; matches: ProductCatalogMatch[] } | { ok: false; message: string }> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const raceId = input.raceId.trim()
  const name = input.name.trim()
  if (!raceId || !name) return { ok: true, matches: [] }
  try {
    const products = await loadProductsForRace(gate.supabase, raceId)
    return {
      ok: true,
      matches: findProductCatalogMatches(
        { raceId, name, duration: input.duration ?? null },
        products,
      ),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not search products." }
  }
}

export async function selectEnquiryEvent(raceId: string): Promise<
  | { ok: true; event: EnquiryCreatedEvent }
  | { ok: false; message: string }
> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const id = raceId.trim()
  if (!id) return { ok: false, message: "Event is missing." }
  const db = await catalogWriteClient(gate.supabase)
  try {
    const loaded = await loadRace(gate.supabase, id)
    if (loaded.error) return { ok: false, message: loaded.error.message }
    if (!loaded.data) return { ok: false, message: "Event not found." }
    await unarchiveIfNeeded(db, id, Boolean(loaded.data.is_archived))
    revalidateEnquiryCatalog(id)
    return {
      ok: true,
      event: toEventOption({
        id: String(loaded.data.id),
        name: String(loaded.data.name),
        season: loaded.data.season as number | null,
        event_date: loaded.data.event_date as string | null,
        category: loaded.data.category as string | null,
        is_archived: false,
      }),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not use that event." }
  }
}

export async function createEnquiryEvent(input: EnquiryEventDraft): Promise<
  | { ok: true; created: boolean; event: EnquiryCreatedEvent; matches: EventCatalogMatch[] }
  | { ok: false; message: string; matches?: EventCatalogMatch[] }
> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const parsed = parseEventDraft(input)
  if (!parsed.ok) return parsed
  const value = parsed.value
  const db = await catalogWriteClient(gate.supabase)

  try {
    const races = await loadRaces(gate.supabase)
    const matches = findEventCatalogMatches(
      { name: value.name, season: value.season, circuit: value.circuit, eventDate: value.eventDate },
      races,
    )
    const existing = matches[0]
    if (existing) {
      await unarchiveIfNeeded(db, existing.id, Boolean(existing.isArchived))
      const loaded = await loadRace(gate.supabase, existing.id)
      const row = loaded.data
      revalidateEnquiryCatalog(existing.id)
      return {
        ok: true,
        created: false,
        matches,
        event: toEventOption(
          row
            ? {
                id: String(row.id),
                name: String(row.name),
                season: row.season as number | null,
                event_date: row.event_date as string | null,
                category: row.category as string | null,
                is_archived: false,
              }
            : { id: existing.id, name: existing.name, season: existing.season, event_date: existing.eventDate, category: existing.category, is_archived: false },
        ),
      }
    }

    const error = await insertEvent(db, value)
    if (error && isUniqueViolation(error)) {
      const racesAfter = await loadRaces(gate.supabase)
      const again = findEventCatalogMatches(
        { name: value.name, season: value.season, circuit: value.circuit, eventDate: value.eventDate },
        racesAfter,
      )
      const hit = again[0] ?? racesAfter.find((row) => row.id === value.id)
      if (hit) {
        await unarchiveIfNeeded(db, hit.id, Boolean(hit.isArchived))
        revalidateEnquiryCatalog(hit.id)
        return {
          ok: true,
          created: false,
          matches: again,
          event: toEventOption({
            id: hit.id,
            name: hit.name,
            season: hit.season,
            event_date: hit.eventDate,
            category: hit.category,
            is_archived: false,
          }),
        }
      }
      return { ok: false, message: catalogMatchMessage("event", again), matches: again }
    }
    if (error) return { ok: false, message: error.message }

    revalidateEnquiryCatalog(value.id)
    return {
      ok: true,
      created: true,
      matches: [],
      event: toEventOption({
        id: value.id,
        name: value.name,
        season: value.season,
        event_date: value.eventDate,
        category: value.category,
        is_archived: false,
      }),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create the event." }
  }
}

async function insertEnquiryProduct(
  db: Awaited<ReturnType<typeof catalogWriteClient>>,
  input: {
    id: string
    raceId: string
    name: string
    duration: string | null
    circuit: string
    location: string
    country: string
    countryCode: string
    eventDate: string
    dateRange: string
    image: string | null
  },
) {
  const { error } = await db.from("packages").insert({
    id: input.id,
    race_id: input.raceId,
    name: input.name,
    circuit: input.circuit,
    location: input.location,
    country: input.country,
    country_code: input.countryCode,
    event_date: input.eventDate,
    date_range: input.dateRange,
    description: "",
    image: input.image || "/placeholder.svg",
    gallery_images: [],
    currency: "USD",
    total_capacity: 0,
    is_enquiry: true,
    is_hidden: true,
    tier: "paddock",
    duration: input.duration,
    inventory_group_id: null,
    inventory_is_standalone: true,
    requires_booking_approval: isPaddockClubPackageName(input.name),
    includes: [],
    featured: false,
    sort_order: 100,
    trade_price: null,
    sell_on_trade_portal: false,
    sell_on_wix: false,
    sell_on_partners: false,
    integration_sync_status: "idle",
  })
  return error
}

export async function createEnquiryProduct(input: {
  raceId?: string | null
  newEvent?: EnquiryEventDraft | null
  name: string
  duration?: string | null
}): Promise<
  | {
      ok: true
      created: boolean
      product: EnquiryCreatedProduct
      event: EnquiryCreatedEvent
      eventCreated: boolean
      matches: ProductCatalogMatch[]
    }
  | { ok: false; message: string; matches?: ProductCatalogMatch[] }
> {
  const gate = await requireAdminAction("deals.manage")
  if (!gate.ok) return gate
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Enter the product name." }

  const db = await catalogWriteClient(gate.supabase)
  let eventCreated = false
  let raceId = input.raceId?.trim() || ""

  try {
    if (!raceId) {
      if (!input.newEvent) return { ok: false, message: "Choose an event, or create a new one." }
      const createdEvent = await createEnquiryEvent(input.newEvent)
      if (!createdEvent.ok) return { ok: false, message: createdEvent.message }
      raceId = createdEvent.event.id
      eventCreated = createdEvent.created
    }

    const raceResult = await loadRace(gate.supabase, raceId)
    if (raceResult.error) return { ok: false, message: raceResult.error.message }
    const race = raceResult.data
    if (!race) return { ok: false, message: "Event not found." }

    if (Boolean(race.is_archived)) {
      await unarchiveIfNeeded(db, raceId, true)
    }

    const category = String(race.category ?? "formula_1")
    const durationInput = (input.duration ?? "").trim()
    const duration = durationInput || inferPackageDurationFromName(name) || ""
    if (category === "formula_1" && !duration) {
      return { ok: false, message: "Choose 3 day, 2 day, or a single-day option for Formula 1 products." }
    }
    if (duration && !isValidPackageDuration(duration)) {
      return { ok: false, message: "Invalid package duration." }
    }

    const products = await loadProductsForRace(gate.supabase, raceId)
    const matches = findProductCatalogMatches(
      { raceId, name, duration: duration || null },
      products,
    )
    const existing = matches[0]
    const eventOption = toEventOption({
      id: String(race.id),
      name: String(race.name),
      season: race.season as number | null,
      event_date: race.event_date as string | null,
      category: race.category as string | null,
      is_archived: false,
    })
    if (existing) {
      revalidateEnquiryCatalog(raceId)
      return {
        ok: true,
        created: false,
        eventCreated,
        event: eventOption,
        matches,
        product: toProductOption(
          { id: existing.id, name: existing.name, currency: "USD" },
          { id: String(race.id), name: String(race.name), season: race.season as number | null },
        ),
      }
    }

    const defaults = packageEventDefaultsFromRace({
      id: raceId,
      name: String(race.name ?? ""),
      circuit: (race as { circuit?: string | null }).circuit ?? null,
      location: String(race.location ?? ""),
      country: String(race.country ?? ""),
      country_code: String(race.country_code ?? ""),
      event_date: String(race.event_date ?? ""),
      date_range: String(race.date_range ?? ""),
      image: (race as { image?: string | null }).image ?? null,
    })
    if (!defaults.circuit) {
      return {
        ok: false,
        message: category === "formula_1"
          ? "This event is missing a circuit. Set it on the event first."
          : "This event is missing a venue. Set it on the event first.",
      }
    }

    let id = generatePackageIdFromRaceAndName(raceId, name)
    if (!/^[a-z0-9][a-z0-9-]{1,126}$/.test(id)) {
      return { ok: false, message: "Could not generate a valid product id from the name. Try a different name." }
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? id : `${id.slice(0, 118)}-${attempt}`
      const { data: dup } = await db.from("packages").select("id").eq("id", candidate).maybeSingle()
      if (!dup) {
        id = candidate
        break
      }
      if (attempt === 49) {
        return { ok: false, message: "A product with this name already exists for this event." }
      }
    }

    const insertError = await insertEnquiryProduct(db, {
      id,
      raceId,
      name,
      duration: duration || null,
      circuit: defaults.circuit,
      location: defaults.location,
      country: defaults.country,
      countryCode: defaults.countryCode,
      eventDate: defaults.eventDate,
      dateRange: defaults.dateRange,
      image: defaults.image || "/placeholder.svg",
    })
    if (insertError && isUniqueViolation(insertError)) {
      const again = findProductCatalogMatches(
        { raceId, name, duration: duration || null },
        await loadProductsForRace(gate.supabase, raceId),
      )
      const hit = again[0]
      if (hit) {
        revalidateEnquiryCatalog(raceId)
        return {
          ok: true,
          created: false,
          eventCreated,
          event: eventOption,
          matches: again,
          product: toProductOption(
            { id: hit.id, name: hit.name, currency: "USD" },
            { id: String(race.id), name: String(race.name), season: race.season as number | null },
          ),
        }
      }
      return { ok: false, message: catalogMatchMessage("product", again), matches: again }
    }
    if (insertError) return { ok: false, message: insertError.message }

    const { error: inventoryError } = await db.from("package_inventory").insert({
      package_id: id,
      qty_available: 0,
      qty_held: 0,
    })
    if (inventoryError) {
      await db.from("packages").delete().eq("id", id)
      return { ok: false, message: inventoryError.message }
    }

    revalidateEnquiryCatalog(raceId)
    revalidatePath(`/admin/catalog/${encodeURIComponent(id)}`)
    return {
      ok: true,
      created: true,
      eventCreated,
      event: eventOption,
      matches: [],
      product: toProductOption(
        { id, name, currency: "USD" },
        { id: String(race.id), name: String(race.name), season: race.season as number | null },
      ),
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create the product." }
  }
}

export const ENQUIRY_CREATE_EVENT_CATEGORIES = ENQUIRY_EVENT_CATEGORIES
