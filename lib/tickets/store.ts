import { sha256 } from "@/lib/booking-forms/snapshot"
import { isOperationsPaid } from "@/lib/operations/fulfilment"
import { operationsTicketStatus } from "@/lib/admin/workflow-status"
import { createAdminClient } from "@/lib/supabase/admin"
import { newTicketSecrets, signTicketQrPayload, ticketSigningSecret } from "@/lib/tickets/crypto"
import {
  applyAdmit,
  canIssueTickets,
  canIssueWalkUpTicket,
  canReceivePhysicalPool,
  decideScan,
  serialIsAvailable,
} from "@/lib/tickets/engine"
import {
  guestTicketStatusFromTicket,
  parseArrivedDates,
  parsePhysicalLocation,
  parseTicketKind,
  parseTicketStatus,
  parseTicketingMode,
  parseValidDays,
  resolvedTicketingMode,
  statusAfterUndoArrival,
  ticketKindForMode,
  validDaysForGuest,
} from "@/lib/tickets/model"
import type { CostDaySlot } from "@/lib/inventory/day-cost-allocation"
import type {
  PhysicalLocation,
  ScanCode,
  ScanMethod,
  TicketKind,
  TicketRecord,
  TicketStatus,
  TicketingMode,
} from "@/lib/tickets/types"

export type TicketsDb = NonNullable<ReturnType<typeof createAdminClient>>

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TicketGuestRow = {
  id: string
  source: "order" | "deal"
  fullName: string | null
  email: string | null
  phone: string | null
  attendanceDay: string | null
  headshotPath: string | null
  tableNumber: string | null
  dietaryRequirements: string | null
  specialRequests: string | null
  ticketNumber: string | null
  ticketStatus: string | null
}

export type BookingTicketContext = {
  dealId: string | null
  orderId: string | null
  paid: boolean
  cancelled: boolean
  quantity: number
  mode: TicketingMode
  packageId: string | null
  packageName: string
  raceId: string | null
  eventDate: string | null
  eventLabel: string
  venueName: string
  duration: string | null
  requireHeadshot: boolean
  doorsTime: string | null
  isDirectClient: boolean
  opsContactEmail: string | null
  opsContactName: string
}

type TicketRow = Record<string, unknown>

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

export function missingTicketingSchema(message: string): boolean {
  return /tickets|ticketing_mode|admit_ticket/i.test(message) && /does not exist|42P01|PGRST/i.test(message)
}

export function mapTicketRow(row: TicketRow, cancelled = false): TicketRecord {
  const orderGuest = asString(row.order_guest_id)
  const dealGuest = asString(row.deal_guest_id)
  return {
    id: String(row.id),
    status: parseTicketStatus(asString(row.status)) ?? "issued",
    kind: parseTicketKind(asString(row.kind)) ?? "zk_digital",
    guest: orderGuest
      ? { source: "order", id: orderGuest }
      : dealGuest
        ? { source: "deal", id: dealGuest }
        : null,
    validDays: parseValidDays(row.valid_days),
    physicalSerial: asString(row.physical_serial),
    physicalLocation: parsePhysicalLocation(asString(row.physical_location)),
    shortCode: String(row.short_code ?? ""),
    tokenHash: String(row.token_hash ?? ""),
    signingKid: String(row.signing_kid ?? "v1"),
    raceId: asString(row.race_id),
    packageId: asString(row.package_id),
    eventDate: asString(row.event_date)?.slice(0, 10) ?? null,
    dealId: asString(row.deal_id),
    orderId: asString(row.order_id),
    issuedAt: asString(row.issued_at),
    sentAt: asString(row.sent_at),
    deliveredAt: asString(row.delivered_at),
    arrivedAt: asString(row.arrived_at),
    arrivedBy: asString(row.arrived_by),
    arrivedDates: parseArrivedDates(row.arrived_dates, asString(row.arrived_at)),
    walkUp: row.walk_up === true,
    holderName: asString(row.holder_name),
    voidedAt: asString(row.voided_at),
    voidedReason: asString(row.voided_reason),
    trackingNumber: asString(row.tracking_number),
    bookingCancelled: cancelled,
  }
}

export async function loadTicketsForBooking(
  db: TicketsDb,
  target: { dealId?: string | null; orderId?: string | null },
): Promise<Array<TicketRecord & { publicToken: string }>> {
  const dealId = target.dealId?.trim() ?? ""
  const orderId = target.orderId?.trim() ?? ""
  let query = db.from("tickets").select("*").order("created_at")
  if (UUID_RE.test(orderId) && UUID_RE.test(dealId)) {
    query = query.or(`order_id.eq.${orderId},deal_id.eq.${dealId}`)
  } else if (UUID_RE.test(orderId)) {
    query = query.eq("order_id", orderId)
  } else if (UUID_RE.test(dealId)) {
    query = query.eq("deal_id", dealId)
  } else {
    return []
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    ...mapTicketRow(row as TicketRow),
    publicToken: String((row as TicketRow).public_token ?? ""),
  }))
}

export async function loadTicketByPublicToken(
  db: TicketsDb,
  token: string,
): Promise<(TicketRecord & { publicToken: string; venueName: string | null; supplierUrl: string | null }) | null> {
  const hash = sha256(token)
  const { data, error } = await db.from("tickets").select("*").eq("token_hash", hash).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as TicketRow
  return {
    ...mapTicketRow(row),
    publicToken: String(row.public_token ?? token),
    venueName: asString(row.venue_name),
    supplierUrl: asString(row.supplier_url),
  }
}

export async function loadTicketById(db: TicketsDb, id: string): Promise<TicketRecord | null> {
  const { data, error } = await db.from("tickets").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapTicketRow(data as TicketRow) : null
}

export async function loadTicketByShortCode(db: TicketsDb, code: string): Promise<TicketRecord | null> {
  const { data, error } = await db.from("tickets").select("*").eq("short_code", code).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapTicketRow(data as TicketRow) : null
}

async function appendEvent(
  db: TicketsDb,
  ticketId: string,
  kind: string,
  actorId: string | null,
  detail?: string,
  metadata: Record<string, unknown> = {},
) {
  await db.from("ticket_events").insert({
    ticket_id: ticketId,
    kind,
    actor_profile_id: actorId,
    detail: detail ?? null,
    metadata,
  })
}

async function syncGuestTicketFields(
  db: TicketsDb,
  ticket: TicketRecord,
) {
  if (!ticket.guest) return
  const table = ticket.guest.source === "order" ? "order_guests" : "deal_guests"
  const status = guestTicketStatusFromTicket(ticket.status)
  const { error } = await db
    .from(table)
    .update({
      ticket_number: ticket.status === "void" ? null : ticket.shortCode,
      ticket_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticket.guest.id)
  if (error && !/ticket_number|ticket_status/i.test(error.message)) throw new Error(error.message)
}

export async function loadBookingGuests(
  db: TicketsDb,
  target: { dealId?: string | null; orderId?: string | null },
): Promise<TicketGuestRow[]> {
  const orderId = target.orderId?.trim() ?? ""
  const dealId = target.dealId?.trim() ?? ""
  const cols =
    "id, full_name, email, phone, attendance_day, headshot_path, table_number, dietary_requirements, special_requests, ticket_number, ticket_status"
  if (UUID_RE.test(orderId)) {
    const { data, error } = await db.from("order_guests").select(cols).eq("order_id", orderId).order("sort_order")
    if (!error && data?.length) {
      return (data as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        source: "order" as const,
        fullName: asString(row.full_name),
        email: asString(row.email),
        phone: asString(row.phone),
        attendanceDay: asString(row.attendance_day),
        headshotPath: asString(row.headshot_path),
        tableNumber: asString(row.table_number),
        dietaryRequirements: asString(row.dietary_requirements),
        specialRequests: asString(row.special_requests),
        ticketNumber: asString(row.ticket_number),
        ticketStatus: asString(row.ticket_status),
      }))
    }
  }
  if (!UUID_RE.test(dealId)) return []
  const { data, error } = await db.from("deal_guests").select(cols).eq("deal_id", dealId).order("sort_order")
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    source: "deal" as const,
    fullName: asString(row.full_name),
    email: asString(row.email),
    phone: asString(row.phone),
    attendanceDay: asString(row.attendance_day),
    headshotPath: asString(row.headshot_path),
    tableNumber: asString(row.table_number),
    dietaryRequirements: asString(row.dietary_requirements),
    specialRequests: asString(row.special_requests),
    ticketNumber: asString(row.ticket_number),
    ticketStatus: asString(row.ticket_status),
  }))
}

export async function loadBookingTicketContext(
  db: TicketsDb,
  target: { dealId?: string | null; orderId?: string | null },
): Promise<BookingTicketContext | null> {
  const dealId = target.dealId?.trim() ?? ""
  const orderId = target.orderId?.trim() ?? ""
  let deal: Record<string, unknown> | null = null
  if (UUID_RE.test(dealId)) {
    const { data } = await db
      .from("deals")
      .select("id, order_id, stage, account_id")
      .eq("id", dealId)
      .maybeSingle()
    deal = data as Record<string, unknown> | null
  } else if (UUID_RE.test(orderId)) {
    const { data } = await db.from("deals").select("id, order_id, stage, account_id").eq("order_id", orderId).maybeSingle()
    deal = data as Record<string, unknown> | null
  }
  const resolvedDealId = asString(deal?.id) ?? (UUID_RE.test(dealId) ? dealId : null)
  const resolvedOrderId = asString(deal?.order_id) ?? (UUID_RE.test(orderId) ? orderId : null)

  let quantity = 1
  let packageId: string | null = null
  let packageName = "Hospitality"
  let raceId: string | null = null
  let eventDate: string | null = null
  let duration: string | null = null
  let eventLabel = "your event"
  let venueName = ""
  let packageMode: string | null = null
  let requireHeadshot = true
  let doorsTime: string | null = null

  if (resolvedDealId) {
    const ticketingSelect =
      "quantity, sort_order, package_id, packages(id, name, duration, event_date, race_id, circuit, ticketing_mode, ticketing_venue_name, ticketing_doors_time, ticketing_require_headshot, races(name, season, event_date))"
    const basicSelect =
      "quantity, sort_order, package_id, packages(id, name, duration, event_date, race_id, circuit, races(name, season, event_date))"
    const ticketingAttempt = await db
      .from("deal_line_items")
      .select(ticketingSelect)
      .eq("deal_id", resolvedDealId)
      .order("sort_order")
    const linesResult =
      ticketingAttempt.error && /ticketing_/i.test(ticketingAttempt.error.message)
        ? await db.from("deal_line_items").select(basicSelect).eq("deal_id", resolvedDealId).order("sort_order")
        : ticketingAttempt
    const { data: lines } = linesResult
    const list = (lines ?? []) as Array<Record<string, unknown>>
    quantity = Math.max(1, list.reduce((sum, line) => sum + Math.max(0, Math.floor(Number(line.quantity) || 0)), 0) || 1)
    const first = list[0]
    const pkgRaw = first?.packages
    const pkg = (Array.isArray(pkgRaw) ? pkgRaw[0] : pkgRaw) as Record<string, unknown> | null
    if (pkg) {
      packageId = asString(pkg.id)
      packageName = asString(pkg.name) ?? packageName
      duration = asString(pkg.duration)
      eventDate = asString(pkg.event_date)?.slice(0, 10) ?? null
      raceId = asString(pkg.race_id)
      packageMode = asString(pkg.ticketing_mode)
      venueName = asString(pkg.ticketing_venue_name) ?? asString(pkg.circuit) ?? ""
      doorsTime = asString(pkg.ticketing_doors_time)
      requireHeadshot = pkg.ticketing_require_headshot !== false
      const raceRaw = pkg.races
      const race = (Array.isArray(raceRaw) ? raceRaw[0] : raceRaw) as Record<string, unknown> | null
      if (race) {
        const season = race.season != null ? String(race.season) : ""
        eventLabel = [asString(race.name), season].filter(Boolean).join(" ").trim() || eventLabel
        eventDate = asString(race.event_date)?.slice(0, 10) ?? eventDate
      }
    }
  } else if (resolvedOrderId) {
    const { data: order } = await db.from("orders").select("guests").eq("id", resolvedOrderId).maybeSingle()
    quantity = Math.max(1, Math.floor(Number(order?.guests) || 1))
  }

  let bookingMode: string | null = null
  if (resolvedOrderId) {
    const { data } = await db.from("order_operations").select("ticketing_mode, fulfilment_status, delivery_status").eq("order_id", resolvedOrderId).maybeSingle()
    bookingMode = asString((data as { ticketing_mode?: string } | null)?.ticketing_mode)
  }
  if (!bookingMode && resolvedDealId) {
    const { data } = await db.from("deal_operations").select("ticketing_mode, fulfilment_status, delivery_status").eq("deal_id", resolvedDealId).maybeSingle()
    bookingMode = asString((data as { ticketing_mode?: string } | null)?.ticketing_mode)
  }

  let invoiceStatus: string | null = null
  if (resolvedOrderId) {
    const { data: invoices } = await db.from("invoices").select("status").eq("order_id", resolvedOrderId)
    invoiceStatus = (invoices ?? []).map((row) => String(row.status)).find((status) => status === "paid" || status === "delivered") ?? (invoices?.[0] ? String(invoices[0].status) : null)
  }

  const stage = asString(deal?.stage)
  const paid = isOperationsPaid({ invoiceStatus, dealStage: stage })
  const cancelled = stage === "cancelled" || stage === "closed_lost"

  return {
    dealId: resolvedDealId,
    orderId: resolvedOrderId,
    paid,
    cancelled,
    quantity,
    mode: resolvedTicketingMode(bookingMode, packageMode),
    packageId,
    packageName,
    raceId,
    eventDate,
    eventLabel,
    venueName,
    duration,
    requireHeadshot,
    doorsTime,
    isDirectClient: false,
    opsContactEmail: null,
    opsContactName: "there",
  }
}

async function insertTicket(
  db: TicketsDb,
  input: {
    kind: TicketKind
    status?: TicketStatus
    dealId: string | null
    orderId: string | null
    packageId: string | null
    raceId: string | null
    eventDate: string | null
    venueName: string | null
    guest: TicketGuestRow | null
    validDays: CostDaySlot[]
    physicalSerial?: string | null
    physicalLocation?: PhysicalLocation | null
    walkUp?: boolean
    holderName?: string | null
    actorId: string
  },
): Promise<TicketRecord & { publicToken: string }> {
  const secrets = newTicketSecrets()
  const now = new Date().toISOString()
  const payload = {
    deal_id: input.dealId,
    order_id: input.orderId,
    package_id: input.packageId,
    race_id: input.raceId,
    order_guest_id: input.guest?.source === "order" ? input.guest.id : null,
    deal_guest_id: input.guest?.source === "deal" ? input.guest.id : null,
    kind: input.kind,
    status: input.status ?? "issued",
    valid_days: input.validDays,
    event_date: input.eventDate,
    venue_name: input.venueName,
    public_token: secrets.token,
    token_hash: secrets.tokenHash,
    short_code: secrets.shortCode,
    signing_kid: "v1",
    physical_serial: blank(input.physicalSerial),
    physical_location: input.physicalLocation ?? null,
    issued_at: now,
    issued_by: input.actorId,
    updated_at: now,
    ...(input.walkUp
      ? { walk_up: true, holder_name: blank(input.holderName) }
      : {}),
  }
  const { data, error } = await db.from("tickets").insert(payload).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  const ticket = { ...mapTicketRow(data as TicketRow), publicToken: secrets.token }
  await appendEvent(db, ticket.id, "issued", input.actorId, `Issued ${ticket.shortCode}`)
  await syncGuestTicketFields(db, ticket)
  return ticket
}

export async function issueTicketsForNamedGuests(
  db: TicketsDb,
  input: { dealId?: string | null; orderId?: string | null; actorId: string; mode?: TicketingMode | null },
): Promise<{ ok: true; issued: number; message: string } | { ok: false; message: string }> {
  const context = await loadBookingTicketContext(db, input)
  if (!context) return { ok: false, message: "Booking not found." }
  const mode = input.mode ?? context.mode
  const kind = ticketKindForMode(mode)
  if (!kind) return { ok: false, message: "This product does not use ZK tickets." }
  const guests = (await loadBookingGuests(db, context)).filter((guest) => guest.fullName)
  const existing = await loadTicketsForBooking(db, context)
  const open = existing.filter((row) => row.status !== "void")
  let issued = 0
  for (const guest of guests) {
    const already = open.some(
      (row) => row.guest && row.guest.source === guest.source && row.guest.id === guest.id,
    )
    const check = canIssueTickets({
      paid: context.paid,
      bookingCancelled: context.cancelled,
      mode,
      guestNamed: Boolean(guest.fullName),
      guestAlreadyHasOpenTicket: already,
      openTicketCount: open.length + issued,
      quantity: context.quantity,
    })
    if (!check.ok) {
      if (already) continue
      return check
    }
    const created = await insertTicket(db, {
      kind,
      dealId: context.dealId,
      orderId: context.orderId,
      packageId: context.packageId,
      raceId: context.raceId,
      eventDate: context.eventDate,
      venueName: context.venueName,
      guest,
      validDays: validDaysForGuest({
        attendanceDay: guest.attendanceDay,
        packageDuration: context.duration,
        eventDate: context.eventDate,
      }),
      physicalLocation: kind === "physical" ? "in_office" : null,
      actorId: input.actorId,
    })
    open.push(created)
    issued += 1
  }
  if (input.mode && (context.dealId || context.orderId)) {
    await saveBookingTicketingMode(db, context, mode)
  }
  if (!issued) return { ok: false, message: "Every named guest already has a live ticket." }
  return { ok: true, issued, message: issued === 1 ? "Issued 1 ticket." : `Issued ${issued} tickets.` }
}

export type WalkUpTicketRow = TicketRecord & { publicToken: string }

export async function loadWalkUpTickets(db: TicketsDb, packageId: string): Promise<WalkUpTicketRow[]> {
  const { data, error } = await db
    .from("tickets")
    .select("*")
    .eq("package_id", packageId)
    .eq("walk_up", true)
    .neq("status", "void")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    ...mapTicketRow(row as TicketRow),
    publicToken: String((row as TicketRow).public_token ?? ""),
  }))
}

export async function issueWalkUpTicket(
  db: TicketsDb,
  input: {
    packageId: string
    actorId: string
    holderName?: string | null
    validDays?: CostDaySlot[]
  },
): Promise<{ ok: true; ticket: WalkUpTicketRow; message: string } | { ok: false; message: string }> {
  const { data: pkg, error } = await db
    .from("packages")
    .select(
      "id, name, duration, event_date, race_id, circuit, ticketing_mode, ticketing_venue_name, races(name, season, event_date)",
    )
    .eq("id", input.packageId)
    .maybeSingle()
  if (error) {
    if (missingTicketingSchema(error.message) || /walk_up|holder_name|tickets_parent/i.test(error.message)) {
      return { ok: false, message: "Apply the latest ticketing migration to create walk-up tickets." }
    }
    return { ok: false, message: error.message }
  }
  if (!pkg) return { ok: false, message: "Product not found." }
  const mode = parseTicketingMode(asString((pkg as { ticketing_mode?: string }).ticketing_mode)) ?? "supplier_direct"
  const kind = ticketKindForMode(mode)
  if (!kind || kind === "physical" || kind === "external_digital") {
    return { ok: false, message: "Walk-up passes are only for products we scan at our door (ZK digital or hybrid)." }
  }
  const existing = await loadWalkUpTickets(db, input.packageId)
  const check = canIssueWalkUpTicket({ mode, liveWalkUpCount: existing.length })
  if (!check.ok) return check
  const raceRaw = (pkg as { races?: { name?: string; event_date?: string } | Array<{ name?: string; event_date?: string }> }).races
  const race = Array.isArray(raceRaw) ? raceRaw[0] : raceRaw
  const eventDate =
    asString(race?.event_date)?.slice(0, 10) ?? asString((pkg as { event_date?: string }).event_date)?.slice(0, 10) ?? null
  const duration = asString((pkg as { duration?: string }).duration)
  const validDays = input.validDays?.length
    ? input.validDays
    : validDaysForGuest({ packageDuration: duration, eventDate })
  try {
    const created = await insertTicket(db, {
      kind,
      dealId: null,
      orderId: null,
      packageId: input.packageId,
      raceId: asString((pkg as { race_id?: string }).race_id),
      eventDate,
      venueName: asString((pkg as { ticketing_venue_name?: string }).ticketing_venue_name),
      guest: null,
      validDays,
      walkUp: true,
      holderName: input.holderName,
      actorId: input.actorId,
    })
    return {
      ok: true,
      ticket: created,
      message: `Issued walk-up pass ${created.shortCode}. Copy the link or email it now.`,
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not issue that ticket."
    if (/parent_check|walk_up|null value.*deal_id/i.test(message)) {
      return { ok: false, message: "Apply the latest ticketing migration to create walk-up tickets." }
    }
    return { ok: false, message }
  }
}

export async function receivePhysicalTickets(
  db: TicketsDb,
  input: { dealId?: string | null; orderId?: string | null; actorId: string; count: number },
): Promise<{ ok: true; received: number; message: string } | { ok: false; message: string }> {
  const context = await loadBookingTicketContext(db, input)
  if (!context) return { ok: false, message: "Booking not found." }
  const existing = await loadTicketsForBooking(db, context)
  const openCount = existing.filter((row) => row.status !== "void").length
  const check = canReceivePhysicalPool({
    paid: context.paid,
    bookingCancelled: context.cancelled,
    expected: context.quantity,
    alreadyOpen: openCount,
    receiving: input.count,
  })
  if (!check.ok) return check
  for (let i = 0; i < input.count; i += 1) {
    await insertTicket(db, {
      kind: "physical",
      dealId: context.dealId,
      orderId: context.orderId,
      packageId: context.packageId,
      raceId: context.raceId,
      eventDate: context.eventDate,
      venueName: context.venueName,
      guest: null,
      validDays: validDaysForGuest({ packageDuration: context.duration, eventDate: context.eventDate }),
      physicalLocation: "in_office",
      actorId: input.actorId,
    })
  }
  if (context.mode !== "hybrid") {
    await saveBookingTicketingMode(db, context, "physical")
  }
  return { ok: true, received: input.count, message: `Recorded ${input.count} physical ticket${input.count === 1 ? "" : "s"} in the office.` }
}

export async function assignPhysicalSerial(
  db: TicketsDb,
  input: { ticketId: string; guest: TicketGuestRow; serial: string; actorId: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const ticket = await loadTicketById(db, input.ticketId)
  if (!ticket || ticket.status === "void") return { ok: false, message: "Ticket not found." }
  const { data: open } = await db.from("tickets").select("physical_serial").neq("status", "void").neq("id", ticket.id)
  const used = (open ?? []).map((row) => String(row.physical_serial ?? "")).filter(Boolean)
  const serialCheck = serialIsAvailable(input.serial, used)
  if (!serialCheck.ok) return serialCheck
  const now = new Date().toISOString()
  const { data, error } = await db
    .from("tickets")
    .update({
      physical_serial: input.serial.trim(),
      order_guest_id: input.guest.source === "order" ? input.guest.id : null,
      deal_guest_id: input.guest.source === "deal" ? input.guest.id : null,
      physical_location: ticket.physicalLocation ?? "in_office",
      valid_days: validDaysForGuest({ attendanceDay: input.guest.attendanceDay, eventDate: ticket.eventDate }),
      updated_at: now,
    })
    .eq("id", ticket.id)
    .select("*")
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  const mapped = mapTicketRow(data as TicketRow)
  await appendEvent(db, mapped.id, "assigned", input.actorId, `Assigned ${input.serial.trim()} to ${input.guest.fullName}`)
  await syncGuestTicketFields(db, mapped)
  return { ok: true, message: `Assigned ${input.serial.trim()} to ${input.guest.fullName}.` }
}

export async function voidAndReissueTicket(
  db: TicketsDb,
  input: { ticketId: string; actorId: string; reason: string },
): Promise<{ ok: true; message: string; publicToken: string } | { ok: false; message: string }> {
  const current = await loadTicketById(db, input.ticketId)
  if (!current) return { ok: false, message: "Ticket not found." }
  if (current.status === "void") return { ok: false, message: "This ticket is already void." }
  const guests = await loadBookingGuests(db, current)
  const guest = current.guest
    ? guests.find((row) => row.source === current.guest?.source && row.id === current.guest.id) ?? null
    : null
  const now = new Date().toISOString()
  const { error: voidError } = await db
    .from("tickets")
    .update({
      status: "void",
      voided_at: now,
      voided_by: input.actorId,
      voided_reason: input.reason.trim() || "Reissued",
      updated_at: now,
    })
    .eq("id", current.id)
    .neq("status", "void")
  if (voidError) return { ok: false, message: voidError.message }
  await appendEvent(db, current.id, "voided", input.actorId, input.reason.trim() || "Reissued")
  await syncGuestTicketFields(db, { ...current, status: "void", voidedAt: now })
  if (!guest?.fullName) {
    return { ok: true, message: "Ticket voided.", publicToken: "" }
  }
  const created = await insertTicket(db, {
    kind: current.kind,
    dealId: current.dealId,
    orderId: current.orderId,
    packageId: current.packageId,
    raceId: current.raceId,
    eventDate: current.eventDate,
    venueName: null,
    guest,
    validDays: current.validDays.length ? current.validDays : validDaysForGuest({ attendanceDay: guest.attendanceDay, eventDate: current.eventDate }),
    physicalSerial: current.kind === "physical" ? null : current.physicalSerial,
    physicalLocation: current.kind === "physical" ? "in_office" : null,
    actorId: input.actorId,
  })
  await db.from("tickets").update({ replaced_by: created.id, updated_at: now }).eq("id", current.id)
  await appendEvent(db, created.id, "reissued", input.actorId, `Replacement for ${current.shortCode}`)
  return { ok: true, message: `Voided ${current.shortCode} and issued ${created.shortCode}.`, publicToken: created.publicToken }
}

export async function markTicketsSentDelivered(
  db: TicketsDb,
  input: { ticketIds: string[]; actorId: string; delivered: boolean },
): Promise<void> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: input.delivered ? "delivered" : "sent",
    sent_at: now,
    sent_by: input.actorId,
    updated_at: now,
  }
  if (input.delivered) patch.delivered_at = now
  for (const id of input.ticketIds) {
    const { data, error } = await db
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .neq("status", "void")
      .select("*")
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) continue
    const ticket = mapTicketRow(data as TicketRow)
    await appendEvent(db, ticket.id, input.delivered ? "delivered" : "sent", input.actorId)
    await syncGuestTicketFields(db, ticket)
  }
}

export async function markPhysicalPosted(
  db: TicketsDb,
  input: { ticketIds: string[]; trackingNumber?: string | null; actorId: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const now = new Date().toISOString()
  const { error } = await db
    .from("tickets")
    .update({
      status: "sent",
      sent_at: now,
      sent_by: input.actorId,
      physical_location: "in_transit",
      tracking_number: blank(input.trackingNumber),
      updated_at: now,
    })
    .in("id", input.ticketIds)
    .neq("status", "void")
  if (error) return { ok: false, message: error.message }
  for (const id of input.ticketIds) {
    await appendEvent(db, id, "posted", input.actorId, blank(input.trackingNumber) ?? "Posted")
  }
  return { ok: true, message: "Marked posted." }
}

export async function voidOpenTicketsForCancelledBooking(
  db: TicketsDb,
  input: { dealId?: string | null; orderId?: string | null; actorId?: string | null; reason?: string },
): Promise<number> {
  const tickets = await loadTicketsForBooking(db, input)
  const live = tickets.filter((row) => row.status !== "void")
  if (!live.length) return 0
  const now = new Date().toISOString()
  const reason = input.reason?.trim() || "Booking cancelled"
  const { error } = await db
    .from("tickets")
    .update({
      status: "void",
      voided_at: now,
      voided_by: input.actorId ?? null,
      voided_reason: reason,
      updated_at: now,
    })
    .in(
      "id",
      live.map((row) => row.id),
    )
    .neq("status", "void")
  if (error) {
    if (missingTicketingSchema(error.message)) return 0
    throw new Error(error.message)
  }
  for (const ticket of live) {
    await appendEvent(db, ticket.id, "voided", input.actorId ?? null, reason)
    await syncGuestTicketFields(db, { ...ticket, status: "void", voidedAt: now, voidedReason: reason })
  }
  return live.length
}

export async function markPhysicalCollected(
  db: TicketsDb,
  input: { ticketId: string; actorId: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from("tickets")
    .update({
      status: "delivered",
      delivered_at: now,
      sent_at: now,
      sent_by: input.actorId,
      physical_location: "with_guest",
      updated_at: now,
    })
    .eq("id", input.ticketId)
    .neq("status", "void")
    .select("*")
    .maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: "Ticket not found." }
  const ticket = mapTicketRow(data as TicketRow)
  await appendEvent(db, ticket.id, "collected", input.actorId)
  await syncGuestTicketFields(db, ticket)
  return { ok: true, message: "Marked collected." }
}

export async function saveBookingTicketingMode(
  db: TicketsDb,
  context: Pick<BookingTicketContext, "dealId" | "orderId">,
  mode: TicketingMode,
) {
  const parsed = parseTicketingMode(mode)
  if (!parsed) return
  const now = new Date().toISOString()
  if (context.orderId) {
    await db.from("order_operations").upsert(
      { order_id: context.orderId, ticketing_mode: parsed, updated_at: now },
      { onConflict: "order_id" },
    )
  }
  if (context.dealId) {
    await db.from("deal_operations").upsert(
      { deal_id: context.dealId, ticketing_mode: parsed, updated_at: now },
      { onConflict: "deal_id" },
    )
  }
  if (parsed === "zk_digital") {
    await ensureZkDigitalFulfilmentDefaults(db, context)
  }
}

async function ensureZkDigitalFulfilmentDefaults(
  db: TicketsDb,
  context: Pick<BookingTicketContext, "dealId" | "orderId">,
) {
  const patch = { client_delivery_method: "send_digital" }
  if (context.orderId) {
    const { data } = await db
      .from("order_operations")
      .select("client_delivery_method")
      .eq("order_id", context.orderId)
      .maybeSingle()
    if (!String((data as { client_delivery_method?: string } | null)?.client_delivery_method ?? "").trim()) {
      await db.from("order_operations").update(patch).eq("order_id", context.orderId)
    }
  }
  if (context.dealId) {
    const { data } = await db
      .from("deal_operations")
      .select("client_delivery_method")
      .eq("deal_id", context.dealId)
      .maybeSingle()
    if (!String((data as { client_delivery_method?: string } | null)?.client_delivery_method ?? "").trim()) {
      await db.from("deal_operations").update(patch).eq("deal_id", context.dealId)
    }
  }
}

export async function recordScanAttempt(
  db: TicketsDb,
  input: {
    ticketId?: string | null
    raceId?: string | null
    payloadPrefix?: string | null
    code: ScanCode
    method: ScanMethod
    actorId: string
    offlineQueuedAt?: string | null
  },
) {
  await db.from("ticket_scan_attempts").insert({
    ticket_id: input.ticketId ?? null,
    race_id: input.raceId ?? null,
    payload_prefix: (input.payloadPrefix ?? "").slice(0, 24) || null,
    code: input.code,
    method: input.method,
    actor_profile_id: input.actorId,
    offline_queued_at: input.offlineQueuedAt ?? null,
  })
}

export async function admitTicketRow(
  db: TicketsDb,
  input: { ticket: TicketRecord; actorId: string; method: ScanMethod; todayIso: string; selectedRaceId?: string | null },
): Promise<{ code: ScanCode; message: string; ticket: TicketRecord; arrivedAt?: string | null; arrivedBy?: string | null }> {
  const decision = decideScan({
    payloadOk: true,
    ticket: input.ticket,
    selectedRaceId: input.selectedRaceId,
    todayIso: input.todayIso,
  })
  if (decision.code !== "ok") {
    await recordScanAttempt(db, {
      ticketId: input.ticket.id,
      raceId: input.selectedRaceId,
      code: decision.code,
      method: input.method,
      actorId: input.actorId,
    })
    return { code: decision.code, message: decision.message, ticket: input.ticket }
  }
  const { data, error } = await db.rpc("admit_ticket", {
    p_ticket_id: input.ticket.id,
    p_staff_id: input.actorId,
    p_method: input.method,
    p_door_date: input.todayIso,
  })
  if (error) {
    const admitted = applyAdmit(input.ticket, new Date().toISOString(), input.actorId, input.todayIso)
    if (!admitted.ok) {
      await recordScanAttempt(db, {
        ticketId: input.ticket.id,
        raceId: input.selectedRaceId,
        code: admitted.code,
        method: input.method,
        actorId: input.actorId,
      })
      return { code: admitted.code, message: decision.message, ticket: input.ticket }
    }
    await db.from("ticket_admissions").insert({
      ticket_id: input.ticket.id,
      door_date: input.todayIso,
      arrived_by: input.actorId,
      method: input.method,
    })
    const { data: updated, error: updateError } = await db
      .from("tickets")
      .update({
        status: "arrived",
        arrived_at: new Date().toISOString(),
        arrived_by: input.actorId,
        arrived_dates: admitted.ticket.arrivedDates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.ticket.id)
      .in("status", ["issued", "sent", "delivered", "arrived"])
      .select("*")
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) {
      const latest = await loadTicketById(db, input.ticket.id)
      const again = decideScan({
        payloadOk: true,
        ticket: latest,
        selectedRaceId: input.selectedRaceId,
        todayIso: input.todayIso,
      })
      await recordScanAttempt(db, {
        ticketId: input.ticket.id,
        raceId: input.selectedRaceId,
        code: again.code,
        method: input.method,
        actorId: input.actorId,
      })
      return { code: again.code, message: again.message, ticket: latest ?? input.ticket, arrivedAt: latest?.arrivedAt, arrivedBy: latest?.arrivedBy }
    }
    const mapped = mapTicketRow(updated as TicketRow)
    await syncGuestTicketFields(db, mapped)
    await recordScanAttempt(db, {
      ticketId: mapped.id,
      raceId: input.selectedRaceId,
      code: "ok",
      method: input.method,
      actorId: input.actorId,
    })
    return { code: "ok", message: "Welcome.", ticket: mapped, arrivedAt: mapped.arrivedAt, arrivedBy: mapped.arrivedBy }
  }
  const payload = data as { code?: string; arrived_at?: string; arrived_by?: string } | null
  const code = (payload?.code as ScanCode | undefined) ?? "unknown"
  const latest = await loadTicketById(db, input.ticket.id)
  if (code === "ok" && latest) await syncGuestTicketFields(db, latest)
  await recordScanAttempt(db, {
    ticketId: input.ticket.id,
    raceId: input.selectedRaceId,
    code,
    method: input.method,
    actorId: input.actorId,
  })
  const messages: Record<ScanCode, string> = {
    ok: "Welcome.",
    already_arrived: "Already arrived today.",
    void: "This ticket was voided.",
    cancelled: "This booking is cancelled.",
    wrong_day: "This ticket is not valid today.",
    wrong_event: "This ticket is for a different event.",
    too_early: "This ticket is not valid yet.",
    not_admittable: "This ticket is not ready to scan.",
    invalid: "This QR is not a ZK ticket.",
    unknown: "This ticket is not on file.",
  }
  return {
    code,
    message: messages[code] ?? decision.message,
    ticket: latest ?? input.ticket,
    arrivedAt: payload?.arrived_at ?? latest?.arrivedAt,
    arrivedBy: payload?.arrived_by ?? latest?.arrivedBy,
  }
}

export async function undoArrival(
  db: TicketsDb,
  input: { ticketId: string; actorId: string; reason: string; doorDate?: string | null },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const ticket = await loadTicketById(db, input.ticketId)
  if (!ticket) return { ok: false, message: "Ticket not found." }
  const doorDate = input.doorDate && /^\d{4}-\d{2}-\d{2}$/.test(input.doorDate)
    ? input.doorDate
    : ticket.arrivedAt?.slice(0, 10) ?? null
  const { data: todayRow } = doorDate
    ? await db
        .from("ticket_admissions")
        .select("arrived_at")
        .eq("ticket_id", ticket.id)
        .eq("door_date", doorDate)
        .maybeSingle()
    : { data: null }
  const stamp = String(todayRow?.arrived_at ?? ticket.arrivedAt ?? "")
  if (!stamp) return { ok: false, message: "This guest is not marked arrived." }
  const arrivedMs = new Date(stamp).getTime()
  if (Number.isFinite(arrivedMs) && Date.now() - arrivedMs > 10 * 60 * 1000) {
    return { ok: false, message: "Undo is only available for 10 minutes after a scan." }
  }
  if (doorDate) {
    await db.from("ticket_admissions").delete().eq("ticket_id", ticket.id).eq("door_date", doorDate)
  }
  const { data: remaining } = await db
    .from("ticket_admissions")
    .select("door_date, arrived_at, arrived_by")
    .eq("ticket_id", ticket.id)
    .order("door_date", { ascending: false })
  const dates = (remaining ?? []).map((row) => String(row.door_date).slice(0, 10)).filter(Boolean)
  const stillIn = dates.length > 0
  const next = stillIn ? "arrived" : statusAfterUndoArrival(ticket)
  const latest = remaining?.[0]
  const now = new Date().toISOString()
  const { error } = await db
    .from("tickets")
    .update({
      status: next,
      arrived_at: stillIn ? (latest?.arrived_at ?? ticket.arrivedAt) : null,
      arrived_by: stillIn ? (latest?.arrived_by ?? ticket.arrivedBy) : null,
      arrived_dates: dates,
      updated_at: now,
    })
    .eq("id", ticket.id)
  if (error) return { ok: false, message: error.message }
  await appendEvent(db, ticket.id, "undone", input.actorId, input.reason.trim() || "Undo scan")
  await syncGuestTicketFields(db, {
    ...ticket,
    status: next,
    arrivedAt: stillIn ? ticket.arrivedAt : null,
    arrivedBy: stillIn ? ticket.arrivedBy : null,
    arrivedDates: dates,
  })
  return { ok: true, message: stillIn ? "Today's scan undone. Earlier days stay marked in." : "Arrival undone." }
}

export function ticketQrPayload(ticketId: string, secret = ticketSigningSecret()): string {
  return signTicketQrPayload(ticketId, secret)
}

export function bookingDeliveryCompleteFromTickets(tickets: readonly TicketRecord[]): boolean {
  const live = tickets.filter((row) => row.status !== "void")
  if (!live.length) return false
  return live.every((row) => row.status === "delivered" || row.status === "arrived")
}

export function ticketOpsDeliveryStatus(tickets: readonly TicketRecord[]): "not_ready" | "ready" | "delivered" {
  if (bookingDeliveryCompleteFromTickets(tickets)) return "delivered"
  if (tickets.some((row) => row.status !== "void")) return "ready"
  return operationsTicketStatus({ fulfilmentStatus: "confirmed", deliveryStatus: "not_ready" })
}
