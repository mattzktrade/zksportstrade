import assert from "node:assert/strict"
import test from "node:test"
import { resolveTicketRecipients, ticketLinkLine } from "../lib/tickets/send"
import type { TicketSendRow } from "../lib/tickets/send"
import type { TicketGuestRow } from "../lib/tickets/store"
import { getTicketEmailFromAddress, DEFAULT_TICKET_EMAIL_FROM } from "../lib/email/config"
import { buildOperationsEmailDraft, operationsEmailHtml, operationsEmailKindLabel } from "../lib/operations/emails"

function ticket(overrides: Partial<TicketSendRow> = {}): TicketSendRow {
  return {
    id: "t1",
    status: "issued",
    kind: "zk_digital",
    guest: { source: "deal", id: "g1" },
    validDays: ["saturday_only"],
    physicalSerial: null,
    physicalLocation: null,
    shortCode: "ZK-ABC123",
    tokenHash: "hash",
    signingKid: "v1",
    raceId: "r1",
    packageId: "p1",
    eventDate: "2026-11-22",
    dealId: "d1",
    orderId: null,
    issuedAt: null,
    sentAt: null,
    deliveredAt: null,
    arrivedAt: null,
    arrivedBy: null,
    voidedAt: null,
    voidedReason: null,
    trackingNumber: null,
    bookingCancelled: false,
    publicToken: "abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuv",
    ...overrides,
  }
}

const guests: TicketGuestRow[] = [
  {
    id: "g1",
    source: "deal",
    fullName: "James Carter",
    email: "james@example.com",
    phone: null,
    attendanceDay: null,
    headshotPath: null,
    tableNumber: null,
    dietaryRequirements: null,
    specialRequests: null,
    ticketNumber: null,
    ticketStatus: null,
  },
  {
    id: "g2",
    source: "deal",
    fullName: "No Email",
    email: null,
    phone: null,
    attendanceDay: null,
    headshotPath: null,
    tableNumber: null,
    dietaryRequirements: null,
    specialRequests: null,
    ticketNumber: null,
    ticketStatus: null,
  },
]

test("direct clients email guests with addresses and pack the rest to the ops contact", () => {
  const result = resolveTicketRecipients({
    isDirectClient: true,
    emailGuestsDirectly: false,
    contactName: "Sarah",
    contactEmail: "sarah@client.com",
    tickets: [
      ticket(),
      ticket({ id: "t2", guest: { source: "deal", id: "g2" }, publicToken: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    ],
    guests,
  })
  assert.equal(result.guestMails.length, 1)
  assert.equal(result.guestMails[0]?.to, "james@example.com")
  assert.equal(result.pack?.tickets.length, 1)
  assert.equal(result.pack?.to, "sarah@client.com")
})

test("agent bookings pack to the ops contact unless email guests is ticked", () => {
  const packed = resolveTicketRecipients({
    isDirectClient: false,
    emailGuestsDirectly: false,
    contactName: "Agent",
    contactEmail: "ops@agent.com",
    tickets: [ticket()],
    guests,
  })
  assert.equal(packed.guestMails.length, 0)
  assert.equal(packed.pack?.to, "ops@agent.com")

  const direct = resolveTicketRecipients({
    isDirectClient: false,
    emailGuestsDirectly: true,
    contactName: "Agent",
    contactEmail: "ops@agent.com",
    tickets: [ticket()],
    guests,
  })
  assert.equal(direct.guestMails.length, 1)
})

test("ticket emails use the connected contact@zk-sport.trade mailbox when Resend is configured", () => {
  const previous = process.env.RESEND_API_KEY
  process.env.RESEND_API_KEY = "re_test"
  delete process.env.TICKET_EMAIL_FROM
  assert.equal(getTicketEmailFromAddress(), DEFAULT_TICKET_EMAIL_FROM)
  assert.match(DEFAULT_TICKET_EMAIL_FROM, /contact@zk-sport\.trade/)
  process.env.RESEND_API_KEY = previous
})

test("ticket link lines leave a blank line so email html can turn the URL into a button", () => {
  const line = ticketLinkLine("James Carter", "abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuv")
  assert.match(line, /James Carter\n\nhttps?:\/\//)
})

test("tickets_ready draft includes the guest link and html turns it into a button", () => {
  assert.equal(operationsEmailKindLabel("tickets_ready"), "Tickets ready")
  const url = "https://zk.example/t/abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuv"
  const draft = buildOperationsEmailDraft({
    kind: "tickets_ready",
    contactName: "James Carter",
    accountName: "Apex",
    eventLabel: "2026 Abu Dhabi Grand Prix",
    quantity: 1,
    ticketLinksBlock: `James Carter\n${url}`,
  })
  assert.match(draft.body, /James Carter/)
  assert.match(draft.body, /\/t\//)
  const html = operationsEmailHtml(`Hi James,\n\n${url}\n\nKind regards,`)
  assert.match(html, /Open your ticket/)
})
