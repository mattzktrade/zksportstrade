"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { parseAccountKinds } from "@/lib/crm/account-kinds"
import { isDirectClientAccount } from "@/lib/operations/fulfilment"
import { loadOperationsEmailTemplates } from "@/app/(admin)/admin/operations/template-actions"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { ticketPublicUrl } from "@/lib/tickets/url"
import { parseTicketingMode } from "@/lib/tickets/model"
import {
  assignPhysicalSerial,
  issueTicketsForNamedGuests,
  loadBookingGuests,
  loadBookingTicketContext,
  loadTicketsForBooking,
  markPhysicalCollected,
  markPhysicalPosted,
  markTicketsSentDelivered,
  missingTicketingSchema,
  receivePhysicalTickets,
  saveBookingTicketingMode,
  voidAndReissueTicket,
  type TicketGuestRow,
} from "@/lib/tickets/store"
import { sendIssuedTickets } from "@/lib/tickets/send"
import { syncBookingDeliveredFromTickets } from "@/lib/tickets/delivery"
import type { TicketingMode } from "@/lib/tickets/types"

type Result<T extends object = object> = ({ ok: true; message: string } & T) | { ok: false; message: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function gate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  const admin = createAdminClient()
  if (!admin) return null
  return { profile, admin, supabase: await createClient() }
}

function revalidateTickets(dealId?: string | null) {
  revalidatePath("/admin/operations")
  revalidatePath("/admin/check-in")
  revalidatePath("/admin")
  if (dealId) revalidatePath(`/admin/deals/${dealId}`)
}

async function opsContact(admin: NonNullable<ReturnType<typeof createAdminClient>>, dealId: string | null) {
  if (!dealId || !UUID_RE.test(dealId)) {
    return { name: "there", email: null as string | null, accountName: "your booking", isDirectClient: false }
  }
  const { data: deal } = await admin
    .from("deals")
    .select("operations_contact_id, primary_contact_id, crm_accounts(name, account_types), crm_contacts!primary_contact_id(full_name, email)")
    .eq("id", dealId)
    .maybeSingle()
  const accountRaw = deal?.crm_accounts as { name?: string; account_types?: unknown } | { name?: string; account_types?: unknown }[] | null
  const account = Array.isArray(accountRaw) ? accountRaw[0] : accountRaw
  let contact = Array.isArray(deal?.crm_contacts) ? deal?.crm_contacts[0] : deal?.crm_contacts
  const opsId = String((deal as { operations_contact_id?: string } | null)?.operations_contact_id ?? "")
  if (UUID_RE.test(opsId)) {
    const { data } = await admin.from("crm_contacts").select("full_name, email").eq("id", opsId).maybeSingle()
    if (data) contact = data
  }
  return {
    name: String((contact as { full_name?: string } | null)?.full_name ?? "there"),
    email: String((contact as { email?: string } | null)?.email ?? "").trim() || null,
    accountName: String(account?.name ?? "your booking"),
    isDirectClient: isDirectClientAccount(parseAccountKinds(account?.account_types)),
  }
}

export type TicketBoardRow = {
  id: string
  status: string
  kind: string
  shortCode: string
  publicUrl: string
  guestId: string | null
  guestSource: "order" | "deal" | null
  guestName: string
  guestEmail: string | null
  physicalSerial: string | null
  physicalLocation: string | null
  trackingNumber: string | null
  validDaysLabel: string
  arrivedAt: string | null
  voided: boolean
}

export async function loadBookingTickets(input: {
  dealId?: string | null
  orderId?: string | null
}): Promise<Result<{ tickets: TicketBoardRow[]; guests: TicketGuestRow[]; mode: TicketingMode; quantity: number }>> {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.view")) {
    return { ok: false, message: "Operations permission is required." }
  }
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Ticketing is not configured." }
  try {
    const context = await loadBookingTicketContext(admin, input)
    if (!context) return { ok: false, message: "Booking not found." }
    const [tickets, guests] = await Promise.all([
      loadTicketsForBooking(admin, context),
      loadBookingGuests(admin, context),
    ])
    const guestName = (ticket: (typeof tickets)[number]) => {
      const guest = guests.find((row) => row.source === ticket.guest?.source && row.id === ticket.guest?.id)
      return guest?.fullName || "Unassigned"
    }
    return {
      ok: true,
      message: "Loaded.",
      mode: context.mode,
      quantity: context.quantity,
      guests,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        status: ticket.status,
        kind: ticket.kind,
        shortCode: ticket.shortCode,
        publicUrl: ticket.publicToken ? ticketPublicUrl(ticket.publicToken) : "",
        guestId: ticket.guest?.id ?? null,
        guestSource: ticket.guest?.source ?? null,
        guestName: guestName(ticket),
        guestEmail: guests.find((row) => row.source === ticket.guest?.source && row.id === ticket.guest?.id)?.email ?? null,
        physicalSerial: ticket.physicalSerial,
        physicalLocation: ticket.physicalLocation,
        trackingNumber: ticket.trackingNumber,
        validDaysLabel: ticket.validDays.join(", "),
        arrivedAt: ticket.arrivedAt,
        voided: ticket.status === "void",
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load tickets."
    if (missingTicketingSchema(message)) {
      return { ok: false, message: "Apply the internal ticketing database migration to use this board." }
    }
    return { ok: false, message }
  }
}

export async function issueBookingTickets(input: {
  dealId?: string | null
  orderId?: string | null
  mode?: string | null
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  try {
    const result = await issueTicketsForNamedGuests(session.admin, {
      dealId: input.dealId,
      orderId: input.orderId,
      actorId: session.profile.id,
      mode: parseTicketingMode(input.mode),
    })
    if (result.ok) revalidateTickets(input.dealId)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not issue tickets."
    if (missingTicketingSchema(message)) {
      return { ok: false, message: "Apply the internal ticketing database migration first." }
    }
    return { ok: false, message }
  }
}

export async function receiveBookingPhysicalTickets(input: {
  dealId?: string | null
  orderId?: string | null
  count: number
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  try {
    const result = await receivePhysicalTickets(session.admin, {
      dealId: input.dealId,
      orderId: input.orderId,
      actorId: session.profile.id,
      count: input.count,
    })
    if (result.ok) revalidateTickets(input.dealId)
    return result
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not receive tickets." }
  }
}

export async function assignBookingPhysicalSerial(input: {
  dealId?: string | null
  ticketId: string
  guestId: string
  guestSource: "order" | "deal"
  serial: string
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const guests = await loadBookingGuests(session.admin, input)
  const guest = guests.find((row) => row.id === input.guestId && row.source === input.guestSource)
  if (!guest) return { ok: false, message: "Guest not found." }
  const result = await assignPhysicalSerial(session.admin, {
    ticketId: input.ticketId,
    guest,
    serial: input.serial,
    actorId: session.profile.id,
  })
  if (result.ok) revalidateTickets(input.dealId)
  return result
}

export async function saveBookingTicketMode(input: {
  dealId?: string | null
  orderId?: string | null
  mode: string
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const mode = parseTicketingMode(input.mode)
  if (!mode) return { ok: false, message: "Choose a ticketing mode." }
  const context = await loadBookingTicketContext(session.admin, input)
  if (!context) return { ok: false, message: "Booking not found." }
  await saveBookingTicketingMode(session.admin, context, mode)
  revalidateTickets(input.dealId)
  return { ok: true, message: "Ticketing mode saved." }
}

export async function sendBookingTickets(input: {
  dealId?: string | null
  orderId?: string | null
  emailGuestsDirectly?: boolean
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const context = await loadBookingTicketContext(session.admin, input)
  if (!context) return { ok: false, message: "Booking not found." }
  const [tickets, guests, contact, templates] = await Promise.all([
    loadTicketsForBooking(session.admin, context),
    loadBookingGuests(session.admin, context),
    opsContact(session.admin, context.dealId),
    loadOperationsEmailTemplates(),
  ])
  const result = await sendIssuedTickets({
    db: session.admin,
    actorId: session.profile.id,
    dealId: context.dealId,
    orderId: context.orderId,
    isDirectClient: contact.isDirectClient,
    emailGuestsDirectly: Boolean(input.emailGuestsDirectly),
    contactName: contact.name,
    contactEmail: contact.email,
    accountName: contact.accountName,
    eventLabel: context.eventLabel,
    tickets,
    guests,
    template: templates.find((row) => row.kind === "tickets_ready") ?? null,
  })
  if (result.ok) revalidateTickets(context.dealId)
  return result
}

export async function markBookingTicketsCopied(input: {
  dealId?: string | null
  orderId?: string | null
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const tickets = await loadTicketsForBooking(session.admin, input)
  const ids = tickets.filter((row) => row.status !== "void" && row.kind !== "physical").map((row) => row.id)
  if (!ids.length) return { ok: false, message: "No digital tickets to mark sent." }
  await markTicketsSentDelivered(session.admin, { ticketIds: ids, actorId: session.profile.id, delivered: true })
  await syncBookingDeliveredFromTickets(session.admin, {
    dealId: input.dealId,
    orderId: input.orderId,
    actorId: session.profile.id,
  })
  revalidateTickets(input.dealId)
  return { ok: true, message: "Marked digital tickets as sent." }
}

export async function reissueBookingTicket(input: {
  dealId?: string | null
  ticketId: string
  reason: string
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const result = await voidAndReissueTicket(session.admin, {
    ticketId: input.ticketId,
    actorId: session.profile.id,
    reason: input.reason,
  })
  if (result.ok) revalidateTickets(input.dealId)
  return result
}

export async function postBookingPhysicalTickets(input: {
  dealId?: string | null
  ticketIds: string[]
  trackingNumber?: string | null
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const result = await markPhysicalPosted(session.admin, {
    ticketIds: input.ticketIds,
    trackingNumber: input.trackingNumber,
    actorId: session.profile.id,
  })
  if (result.ok) revalidateTickets(input.dealId)
  return result
}

export async function collectBookingPhysicalTicket(input: {
  dealId?: string | null
  orderId?: string | null
  ticketId: string
}): Promise<Result> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const result = await markPhysicalCollected(session.admin, {
    ticketId: input.ticketId,
    actorId: session.profile.id,
  })
  if (result.ok) {
    await syncBookingDeliveredFromTickets(session.admin, {
      dealId: input.dealId,
      orderId: input.orderId,
      actorId: session.profile.id,
    })
    revalidateTickets(input.dealId)
  }
  return result
}
