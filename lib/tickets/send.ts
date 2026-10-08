import { sendTicketClientEmail } from "@/lib/email/send-ticket-email"
import { buildOperationsEmailDraft, type OperationsEmailTemplate } from "@/lib/operations/emails"
import { ticketPublicUrl } from "@/lib/tickets/url"
import { markTicketsSentDelivered, type TicketGuestRow } from "@/lib/tickets/store"
import { syncBookingDeliveredFromTickets } from "@/lib/tickets/delivery"
import type { TicketsDb } from "@/lib/tickets/store"
import type { TicketRecord } from "@/lib/tickets/types"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type TicketSendRow = TicketRecord & { publicToken: string }

export function ticketLinkLine(guestName: string, token: string): string {
  return `${guestName.trim() || "Guest"}\n\n${ticketPublicUrl(token)}`
}

export function resolveTicketRecipients(input: {
  isDirectClient: boolean
  emailGuestsDirectly: boolean
  contactName: string
  contactEmail: string | null
  tickets: TicketSendRow[]
  guests: TicketGuestRow[]
}): {
  guestMails: Array<{ to: string; toName: string; ticket: TicketSendRow; guest: TicketGuestRow }>
  pack: { to: string; toName: string; tickets: TicketSendRow[] } | null
} {
  const guestById = new Map(input.guests.map((guest) => [`${guest.source}:${guest.id}`, guest]))
  const sendDirect = input.isDirectClient || input.emailGuestsDirectly
  const guestMails: Array<{ to: string; toName: string; ticket: TicketSendRow; guest: TicketGuestRow }> = []
  const leftover: TicketSendRow[] = []
  for (const ticket of input.tickets) {
    if (ticket.status === "void" || !ticket.publicToken) continue
    const guest = ticket.guest ? guestById.get(`${ticket.guest.source}:${ticket.guest.id}`) : null
    const email = guest?.email?.trim().toLowerCase() ?? ""
    if (sendDirect && guest && EMAIL_RE.test(email)) {
      guestMails.push({ to: email, toName: guest.fullName || "Guest", ticket, guest })
    } else {
      leftover.push(ticket)
    }
  }
  const contact = input.contactEmail?.trim().toLowerCase() ?? ""
  const pack =
    leftover.length && EMAIL_RE.test(contact)
      ? { to: contact, toName: input.contactName, tickets: leftover }
      : null
  return { guestMails, pack }
}

export async function sendIssuedTickets(input: {
  db: TicketsDb
  actorId: string
  dealId: string | null
  orderId: string | null
  isDirectClient: boolean
  emailGuestsDirectly: boolean
  contactName: string
  contactEmail: string | null
  accountName: string
  eventLabel: string
  tickets: TicketSendRow[]
  guests: TicketGuestRow[]
  template?: OperationsEmailTemplate | null
}): Promise<{ ok: true; message: string; sent: number } | { ok: false; message: string }> {
  const live = input.tickets.filter((row) => row.status !== "void" && row.kind !== "physical" && row.publicToken)
  if (!live.length) return { ok: false, message: "There are no digital tickets to email." }
  const recipients = resolveTicketRecipients({
    isDirectClient: input.isDirectClient,
    emailGuestsDirectly: input.emailGuestsDirectly,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    tickets: live,
    guests: input.guests,
  })
  if (!recipients.guestMails.length && !recipients.pack) {
    return { ok: false, message: "Add a guest email or ops contact email, or copy the links instead." }
  }

  const sentIds: string[] = []
  let sent = 0

  for (const mail of recipients.guestMails) {
    const draft = buildOperationsEmailDraft({
      kind: "tickets_ready",
      contactName: mail.toName,
      accountName: input.accountName,
      eventLabel: input.eventLabel,
      quantity: 1,
      ticketLinksBlock: ticketLinkLine(mail.toName, mail.ticket.publicToken),
      template: input.template,
    })
    const result = await sendTicketClientEmail({
      to: mail.to,
      subject: draft.subject,
      body: draft.body,
    })
    if (!result.ok) return { ok: false, message: result.error ?? result.skipped ?? "Could not send ticket email." }
    sentIds.push(mail.ticket.id)
    sent += 1
    if (input.dealId) {
      await input.db.from("operations_emails").insert({
        deal_id: input.dealId,
        order_id: input.orderId,
        kind: "tickets_ready",
        to_email: mail.to,
        to_name: mail.toName,
        subject: draft.subject,
        body_text: draft.body,
        sent_by: input.actorId,
      })
    }
  }

  if (recipients.pack) {
    const block = recipients.pack.tickets
      .map((ticket) => {
        const guest = input.guests.find((row) => row.source === ticket.guest?.source && row.id === ticket.guest?.id)
        return ticketLinkLine(guest?.fullName || ticket.shortCode, ticket.publicToken)
      })
      .join("\n\n")
    const draft = buildOperationsEmailDraft({
      kind: "tickets_ready",
      contactName: recipients.pack.toName,
      accountName: input.accountName,
      eventLabel: input.eventLabel,
      quantity: recipients.pack.tickets.length,
      ticketLinksBlock: block,
      template: input.template,
    })
    const result = await sendTicketClientEmail({
      to: recipients.pack.to,
      subject: draft.subject,
      body: draft.body,
    })
    if (!result.ok) return { ok: false, message: result.error ?? result.skipped ?? "Could not send the ticket pack." }
    sentIds.push(...recipients.pack.tickets.map((ticket) => ticket.id))
    sent += 1
    if (input.dealId) {
      await input.db.from("operations_emails").insert({
        deal_id: input.dealId,
        order_id: input.orderId,
        kind: "tickets_ready",
        to_email: recipients.pack.to,
        to_name: recipients.pack.toName,
        subject: draft.subject,
        body_text: draft.body,
        sent_by: input.actorId,
      })
    }
  }

  await markTicketsSentDelivered(input.db, { ticketIds: [...new Set(sentIds)], actorId: input.actorId, delivered: true })
  await syncBookingDeliveredFromTickets(input.db, {
    dealId: input.dealId,
    orderId: input.orderId,
    actorId: input.actorId,
  })
  return {
    ok: true,
    sent,
    message: sent === 1 ? "Sent 1 ticket email." : `Sent ticket email to ${sent} inboxes.`,
  }
}
