import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { expandBookingGuestSeats } from "../lib/admin/package-guest-list-model"
import {
  bookingDayPlaces,
  desiredGuestsFromForm,
  emptyGuestFormPeople,
  ensureGuestDetailsLinkInBody,
  guestDetailsDateRangeLabel,
  guestDetailsFormCanSubmit,
  guestDetailsFormUrl,
  guestDetailsInviteExpiry,
  guestDetailsStatusAfterForm,
  guestDetailsTokenFromText,
  planGuestFormUpserts,
  sameGuestQuantity,
  seedGuestDetailsForm,
  type GuestFormPerson,
} from "../lib/guest-details/model"

function person(overrides: Partial<GuestFormPerson>): GuestFormPerson {
  return {
    id: "g1",
    fullName: "",
    isLeadGuest: false,
    headshotPath: null,
    ...overrides,
  }
}

test("3-day Sunday race produces Friday-Sunday places with matching quantities", () => {
  const places = bookingDayPlaces([{ duration: "3_day", quantity: 2 }], "2026-12-06")
  assert.deepEqual(
    places.map((place) => [place.day, place.quantity, place.shortLabel]),
    [
      ["friday_only", 2, "Friday"],
      ["saturday_only", 2, "Saturday"],
      ["sunday_only", 2, "Sunday"],
    ],
  )
  assert.equal(sameGuestQuantity(places), 2)
  assert.equal(guestDetailsDateRangeLabel(places), "Fri 4 Dec – Sun 6 Dec")
})

test("mixed single-day quantities cannot use the same-guest list", () => {
  const places = bookingDayPlaces(
    [
      { duration: "friday_only", quantity: 2 },
      { duration: "sunday_only", quantity: 1 },
    ],
    "2026-12-06",
  )
  assert.equal(sameGuestQuantity(places), null)
  assert.equal(places.length, 2)
})

test("submit is allowed with only the lead guest once they have a name and headshot", () => {
  const lead = person({
    fullName: "James Carter",
    isLeadGuest: true,
    headshotPath: "guest-headshots/a/b.jpg",
  })
  const blank = person({ id: "g2", isLeadGuest: false })
  const result = guestDetailsFormCanSubmit({
    mode: "same",
    sameGuests: [lead, blank],
    perDayGuests: {},
    days: ["friday_only", "saturday_only", "sunday_only"],
  })
  assert.equal(result.ok, true)
})

test("submit rejects a named guest without a headshot", () => {
  const result = guestDetailsFormCanSubmit({
    mode: "same",
    sameGuests: [
      person({ fullName: "James Carter", isLeadGuest: true, headshotPath: "path.jpg" }),
      person({ id: "g2", fullName: "Sophie Williams", isLeadGuest: false }),
    ],
    perDayGuests: {},
    days: ["friday_only"],
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.message, /Sophie Williams/)
})

test("per-day expansion keeps the same order quantity on each race day", () => {
  const seats = expandBookingGuestSeats({
    quantity: 2,
    daySlots: ["friday_only", "saturday_only", "sunday_only"],
    mode: "per_day",
    guests: [
      {
        id: "fri-1",
        fullName: "James Carter",
        tableNumber: null,
        ticketNumber: null,
        paddockTour: null,
        ticketStatus: "pending",
        sortOrder: 0,
        attendanceDay: "friday_only",
      },
      {
        id: "sat-1",
        fullName: "Alex Reed",
        tableNumber: null,
        ticketNumber: null,
        paddockTour: null,
        ticketStatus: "pending",
        sortOrder: 0,
        attendanceDay: "saturday_only",
      },
    ],
  })
  assert.equal(seats.length, 6)
  const friday = seats.filter((seat) => seat.daySlots[0] === "friday_only")
  const saturday = seats.filter((seat) => seat.daySlots[0] === "saturday_only")
  assert.equal(friday.length, 2)
  assert.equal(friday[0]?.guest?.fullName, "James Carter")
  assert.equal(friday[1]?.guest, null)
  assert.equal(saturday[0]?.guest?.fullName, "Alex Reed")
  assert.notEqual(friday[0]?.guest?.id, saturday[0]?.guest?.id)
})

test("submitted lead guest marks operations guest details complete", () => {
  assert.equal(
    guestDetailsStatusAfterForm({
      namedCount: 1,
      ticketQuantity: 4,
      mode: "same",
      dayCount: 3,
      submitted: true,
      hasNamedLead: true,
      currentStatus: "requested",
    }),
    "complete",
  )
  assert.equal(
    guestDetailsStatusAfterForm({
      namedCount: 1,
      ticketQuantity: 4,
      mode: "same",
      dayCount: 3,
      submitted: false,
      hasNamedLead: true,
      currentStatus: "requested",
    }),
    "partial",
  )
})

test("invite expiry covers the event when it is more than 120 days away", () => {
  const now = new Date("2026-01-01T00:00:00Z")
  const expiry = guestDetailsInviteExpiry("2026-12-06", now)
  assert.equal(expiry.toISOString().slice(0, 10), "2026-12-20")
  assert.match(guestDetailsFormUrl("https://zk.example", "tok_1"), /\/guest-details\/tok_1$/)
  assert.equal(emptyGuestFormPeople(2).length, 2)
  assert.equal(emptyGuestFormPeople(2)[0]?.isLeadGuest, true)
})

test("guest details form migration stores per-day attendance and hashed invites", () => {
  const sql = readFileSync("supabase/migrations/20260911170000_guest_details_form.sql", "utf8")
  assert.match(sql, /guest_details_invites/)
  assert.match(sql, /attendance_day/)
  assert.match(sql, /headshot_path/)
  assert.match(sql, /guest_attendance_mode/)
  assert.match(sql, /guest-headshots/)
})

test("same-mode rows migrate onto the first day's seats when switching to per-day", () => {
  const plan = planGuestFormUpserts(
    [
      { id: "g1", attendanceDay: null, sortOrder: 0, fullName: "James Carter", tableNumber: "12" },
      { id: "g2", attendanceDay: null, sortOrder: 1, fullName: "Sophie Williams" },
    ],
    [
      { id: null, fullName: "James Carter", isLeadGuest: true, headshotPath: "a/1.jpg", attendanceDay: "friday_only", sortOrder: 0 },
      { id: null, fullName: "Sophie Williams", isLeadGuest: false, headshotPath: "a/2.jpg", attendanceDay: "friday_only", sortOrder: 1 },
      { id: null, fullName: "Alex Reed", isLeadGuest: false, headshotPath: "a/3.jpg", attendanceDay: "saturday_only", sortOrder: 0 },
    ],
  )
  assert.equal(plan.updates.length, 2)
  assert.equal(plan.updates[0]?.id, "g1")
  assert.equal(plan.updates[0]?.row.attendanceDay, "friday_only")
  assert.equal(plan.updates[1]?.id, "g2")
  assert.equal(plan.inserts.length, 1)
  assert.equal(plan.inserts[0]?.fullName, "Alex Reed")
  assert.deepEqual(plan.deleteIds, [])
})

test("switching back to same guests deletes other-day names that have no ticket fields", () => {
  const plan = planGuestFormUpserts(
    [
      { id: "fri", attendanceDay: "friday_only", sortOrder: 0, fullName: "James Carter" },
      { id: "sat", attendanceDay: "saturday_only", sortOrder: 0, fullName: "Alex Reed" },
    ],
    [{ id: null, fullName: "James Carter", isLeadGuest: true, headshotPath: "a/1.jpg", attendanceDay: null, sortOrder: 0 }],
  )
  assert.equal(plan.updates[0]?.id, "fri")
  assert.equal(plan.updates[0]?.row.attendanceDay, null)
  assert.deepEqual(plan.deleteIds, ["sat"])
})

test("desired rows keep one lead and skip blank extra slots", () => {
  const rows = desiredGuestsFromForm({
    mode: "per_day",
    sameGuests: [],
    perDayGuests: {
      friday_only: [
        person({ fullName: "James Carter", isLeadGuest: true, headshotPath: "a.jpg" }),
        person({ id: "", fullName: "", isLeadGuest: true }),
      ],
      saturday_only: [person({ id: "g2", fullName: "Alex Reed", isLeadGuest: true, headshotPath: "b.jpg" })],
    },
    days: ["friday_only", "saturday_only"],
  })
  assert.equal(rows.length, 2)
  assert.equal(rows.filter((row) => row.isLeadGuest).length, 1)
  assert.equal(rows[0]?.isLeadGuest, true)
  assert.equal(rows[1]?.isLeadGuest, false)
})

test("seeded form hides same-guest mode when day quantities differ", () => {
  const places = bookingDayPlaces(
    [
      { duration: "friday_only", quantity: 2 },
      { duration: "sunday_only", quantity: 1 },
    ],
    "2026-12-06",
  )
  const seeded = seedGuestDetailsForm({ guests: [], places, storedMode: "same" })
  assert.equal(seeded.allowSameMode, false)
  assert.equal(seeded.mode, "per_day")
  assert.equal(seeded.showModePicker, true)
})

test("email body keeps an existing guest-details link and can recover the token", () => {
  const token = "abcdefghijklmnopqrstuvwxabcdefghijklmnopq"
  const url = `https://zk.example/guest-details/${token}`
  const body = ensureGuestDetailsLinkInBody(`Hi Sarah,\n\n${url}\n\nKind regards,`, "https://other/guest-details/zzzz")
  assert.match(body, new RegExp(token))
  assert.doesNotMatch(body, /zzzz/)
  assert.equal(guestDetailsTokenFromText(body), token)
})
