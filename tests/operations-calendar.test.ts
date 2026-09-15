import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import {
  buildOperationsCalendarFeed,
  filterOperationsCalendarFeed,
  operationsCalendarFilterLabel,
  operationsCalendarIcs,
  operationsCalendarUpcoming,
} from "../lib/operations/calendar"

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "deal-1",
    accountName: "Apex",
    eventPackage: "2026 Abu Dhabi Grand Prix · Paddock Club",
    eventDate: "2026-12-06",
    invoiceStatus: "paid",
    dealStage: "paid_confirmed",
    guestDetailsStatus: "requested",
    completeGuestCount: 0,
    quantity: 4,
    supplierFulfilmentMethod: "collect_from_supplier",
    clientDeliveryMethod: "local_collection",
    supplierDetailsSentAt: null,
    ticketsReceivedAt: null,
    deliveryStatus: "not_ready",
    fulfilmentStatus: "confirmed",
    isDirectClient: true,
    thankYouSentAt: null,
    thankYouSkippedAt: null,
    hasDeliveryProof: false,
    guestDetailsDeadline: "2026-10-02",
    deliveryDueAt: "2026-12-04",
    dealId: "deal-uuid",
    purchaseOrderIds: ["po-1"],
    ...overrides,
  }
}

test("calendar feed dedupes race weekends and keeps booking-level deadlines", () => {
  const items = buildOperationsCalendarFeed(
    [
      booking(),
      booking({ id: "deal-2", accountName: "QuintEvents", dealId: "deal-2" }),
    ],
    [],
  )
  const races = items.filter((item) => item.kind === "race")
  assert.equal(races.length, 1)
  assert.equal(races[0]?.title, "2026 Abu Dhabi Grand Prix")
  assert.equal(races[0]?.bookingIds.length, 2)
  assert.equal(items.filter((item) => item.kind === "guest_deadline").length, 2)
})

test("filter chips use named labels", () => {
  assert.equal(operationsCalendarFilterLabel("all"), "All events")
  assert.equal(operationsCalendarFilterLabel("guest_deadline"), "Guest deadlines")
})

test("staff tasks appear on the calendar and stay visible when filtering by event", () => {
  const items = buildOperationsCalendarFeed([booking()], [
    {
      id: "task-1",
      title: "Send seating plan",
      notes: "QuintEvents",
      date: "2026-12-01",
      startTime: "12:00",
      endTime: null,
      dealId: null,
      orderId: null,
    },
  ])
  assert.equal(items.some((item) => item.kind === "task" && item.title === "Send seating plan"), true)
  const filtered = filterOperationsCalendarFeed(items, "task")
  assert.equal(filtered.length, 1)
  const byEvent = filterOperationsCalendarFeed(items, "all", "other-event")
  assert.equal(byEvent.some((item) => item.kind === "task"), true)
})

test("next 7 days skips the selected day and includes the following week", () => {
  const items = buildOperationsCalendarFeed([booking()], [])
  const upcoming = operationsCalendarUpcoming(items, "2026-12-04", 7)
  assert.equal(upcoming.some((item) => item.date === "2026-12-06"), true)
  assert.equal(upcoming.some((item) => item.date === "2026-12-04"), false)
})

test("calendar export writes an ics feed", () => {
  const items = buildOperationsCalendarFeed([booking()], [])
  const ics = operationsCalendarIcs(items, new Date("2026-09-15T12:00:00Z"))
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /SUMMARY:2026 Abu Dhabi Grand Prix/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261206/)
})

test("calendar entries migration exists", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  const sql = readFileSync(join(root, "supabase/migrations/20260915140000_operations_calendar_entries.sql"), "utf8")
  assert.match(sql, /operations_calendar_entries/)
  assert.match(sql, /on_date date not null/)
})
