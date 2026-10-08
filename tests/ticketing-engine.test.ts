import assert from "node:assert/strict"
import test from "node:test"
import { encodeShortCode, signTicketQrPayload, verifyTicketQrPayload } from "../lib/tickets/crypto"
import {
  applyAdmit,
  applyVoid,
  canIssueTickets,
  canReceivePhysicalPool,
  decideScan,
  serialIsAvailable,
} from "../lib/tickets/engine"
import { guestTicketStatusFromTicket, ticketKindForMode, ticketValidOnIsoDate } from "../lib/tickets/model"
import type { TicketRecord } from "../lib/tickets/types"

const SECRET = "test-ticket-secret"

function ticket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "issued",
    kind: "zk_digital",
    guest: { source: "deal", id: "g1" },
    validDays: ["saturday_only"],
    physicalSerial: null,
    physicalLocation: null,
    shortCode: "ZK-ABC123",
    tokenHash: "abc",
    signingKid: "v1",
    raceId: "race-1",
    packageId: "pkg-1",
    eventDate: "2026-11-22",
    dealId: "deal-1",
    orderId: null,
    issuedAt: "2026-10-01T00:00:00Z",
    sentAt: null,
    deliveredAt: null,
    arrivedAt: null,
    arrivedBy: null,
    voidedAt: null,
    voidedReason: null,
    trackingNumber: null,
    bookingCancelled: false,
    ...overrides,
  }
}

test("supplier-direct products never mint ZK tickets", () => {
  assert.equal(ticketKindForMode("supplier_direct"), null)
  const blocked = canIssueTickets({
    paid: true,
    bookingCancelled: false,
    mode: "supplier_direct",
    guestNamed: true,
    guestAlreadyHasOpenTicket: false,
    openTicketCount: 0,
    quantity: 2,
  })
  assert.equal(blocked.ok, false)
})

test("issue requires paid, named guest, unique live ticket, and quantity cap", () => {
  const base = {
    paid: true,
    bookingCancelled: false,
    mode: "zk_digital" as const,
    guestNamed: true,
    guestAlreadyHasOpenTicket: false,
    openTicketCount: 1,
    quantity: 2,
  }
  assert.equal(canIssueTickets(base).ok, true)
  assert.equal(canIssueTickets({ ...base, paid: false }).ok, false)
  assert.equal(canIssueTickets({ ...base, guestNamed: false }).ok, false)
  assert.equal(canIssueTickets({ ...base, guestAlreadyHasOpenTicket: true }).ok, false)
  assert.equal(canIssueTickets({ ...base, openTicketCount: 2 }).ok, false)
  assert.equal(canIssueTickets({ ...base, bookingCancelled: true }).ok, false)
})

test("physical receive cannot exceed booking quantity", () => {
  assert.equal(canReceivePhysicalPool({ paid: true, bookingCancelled: false, expected: 4, alreadyOpen: 2, receiving: 2 }).ok, true)
  assert.equal(canReceivePhysicalPool({ paid: true, bookingCancelled: false, expected: 4, alreadyOpen: 2, receiving: 3 }).ok, false)
})

test("live physical serials cannot be reused", () => {
  assert.equal(serialIsAvailable("A-100", ["B-1"]).ok, true)
  assert.equal(serialIsAvailable("A-100", ["a-100"]).ok, false)
  assert.equal(serialIsAvailable("  ", []).ok, false)
})

test("signed QR verifies and rejects tampering", () => {
  const id = "22222222-2222-4222-8222-222222222222"
  const payload = signTicketQrPayload(id, SECRET)
  assert.equal(verifyTicketQrPayload(payload, SECRET).ok, true)
  assert.equal(verifyTicketQrPayload(payload.slice(0, -1) + "x", SECRET).ok, false)
  assert.equal(verifyTicketQrPayload("https://example/t/abc", SECRET).ok, false)
})

test("short codes are Crockford-style ZK- plus six characters", () => {
  const code = encodeShortCode(Uint8Array.from([0x01, 0x02, 0x03, 0x04]))
  assert.match(code, /^ZK-[0-9A-Z]{6}$/)
  assert.doesNotMatch(code, /[ILOU]/)
})

test("scan admits a live Saturday ticket on Saturday and rejects Sunday", () => {
  const live = ticket()
  const ok = decideScan({ payloadOk: true, ticket: live, selectedRaceId: "race-1", todayIso: "2026-11-21" })
  assert.equal(ok.code, "ok")
  const wrongDay = decideScan({ payloadOk: true, ticket: live, selectedRaceId: "race-1", todayIso: "2026-11-22" })
  assert.equal(wrongDay.code, "wrong_day")
})

test("scan rejects wrong event, void, cancelled, and bad signatures without leaking", () => {
  assert.equal(decideScan({ payloadOk: false, ticket: null, todayIso: "2026-11-21" }).code, "invalid")
  assert.equal(decideScan({ payloadOk: true, ticket: null, todayIso: "2026-11-21" }).code, "unknown")
  assert.equal(
    decideScan({ payloadOk: true, ticket: ticket({ raceId: "other" }), selectedRaceId: "race-1", todayIso: "2026-11-21" }).code,
    "wrong_event",
  )
  assert.equal(decideScan({ payloadOk: true, ticket: ticket({ status: "void", voidedAt: "x" }), todayIso: "2026-11-21" }).code, "void")
  assert.equal(
    decideScan({ payloadOk: true, ticket: ticket({ bookingCancelled: true }), todayIso: "2026-11-21" }).code,
    "cancelled",
  )
})

test("concurrent admit: only the first applyAdmit wins", () => {
  const live = ticket()
  const first = applyAdmit(live, "2026-11-21T17:00:00Z", "staff-1")
  assert.equal(first.ok, true)
  const second = applyAdmit(first.ok ? first.ticket : live, "2026-11-21T17:00:01Z", "staff-2")
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.code, "already_arrived")
  const already = decideScan({
    payloadOk: true,
    ticket: first.ok ? first.ticket : live,
    selectedRaceId: "race-1",
    todayIso: "2026-11-21",
  })
  assert.equal(already.code, "already_arrived")
})

test("void then a new ticket is the only live credential", () => {
  const live = ticket()
  const voided = applyVoid(live, "2026-11-01T00:00:00Z", "Name change")
  assert.equal(voided.status, "void")
  assert.equal(
    decideScan({ payloadOk: true, ticket: voided, selectedRaceId: "race-1", todayIso: "2026-11-21" }).code,
    "void",
  )
  const replacement = ticket({ id: "33333333-3333-4333-8333-333333333333", shortCode: "ZK-NEW001" })
  assert.equal(
    decideScan({ payloadOk: true, ticket: replacement, selectedRaceId: "race-1", todayIso: "2026-11-21" }).code,
    "ok",
  )
})

test("guest list status is derived from the ticket row", () => {
  assert.equal(guestTicketStatusFromTicket("draft"), "pending")
  assert.equal(guestTicketStatusFromTicket("issued"), "issued")
  assert.equal(guestTicketStatusFromTicket("sent"), "posted")
  assert.equal(guestTicketStatusFromTicket("arrived"), "posted")
  assert.equal(guestTicketStatusFromTicket("void"), "pending")
})

test("multi-day tickets are valid on each listed day only", () => {
  const three = ticket({ validDays: ["friday_only", "saturday_only", "sunday_only"] })
  assert.equal(ticketValidOnIsoDate(three, "2026-11-20"), true)
  assert.equal(ticketValidOnIsoDate(three, "2026-11-21"), true)
  assert.equal(ticketValidOnIsoDate(three, "2026-11-22"), true)
  assert.equal(ticketValidOnIsoDate(three, "2026-11-19"), false)
})
