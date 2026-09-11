import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  assignSuppliersAcrossDays,
  assignSuppliersToSeats,
  expandGuestSeats,
  formatGuestListDayChipLabel,
  guestDetailsNeeded,
  guestListDayChips,
  guestListStats,
  parseGuestTicketStatus,
  seatAttendsDay,
  supplierDetailsState,
} from "../lib/admin/package-guest-list-model"

test("placeholders fill unsold guest name slots without inventing people", () => {
  const seats = expandGuestSeats(4, [
    {
      id: "g1",
      fullName: "James Carter",
      tableNumber: "12",
      ticketNumber: "PC-1",
      paddockTour: null,
      ticketStatus: "issued",
      sortOrder: 0,
    },
  ])
  assert.equal(seats.length, 4)
  assert.equal(seats[0]?.guest?.fullName, "James Carter")
  assert.equal(seats.filter((seat) => guestDetailsNeeded(seat.guest)).length, 3)
})

test("FIFO supplier slices follow the purchase, including leftover unassigned seats", () => {
  const seats = assignSuppliersToSeats(expandGuestSeats(5, []), [
    { name: "F1 Experiences", quantity: 2, deadline: "2026-11-20" },
    { name: "QPD", quantity: 2, deadline: "2026-11-18" },
  ])
  assert.equal(seats[0]?.supplierName, "F1 Experiences")
  assert.equal(seats[1]?.supplierDeadline, "2026-11-20")
  assert.equal(seats[2]?.supplierName, "QPD")
  assert.equal(seats[4]?.supplierName, null)
})

test("supplier details become overdue only when unsent and past the deadline", () => {
  assert.equal(supplierDetailsState("2026-11-01", "2026-11-20", "2026-11-21"), "sent")
  assert.equal(supplierDetailsState(null, "2026-11-20", "2026-11-21"), "overdue")
  assert.equal(supplierDetailsState(null, "2026-11-20", "2026-11-20"), "not_sent")
  assert.equal(supplierDetailsState(null, null, "2026-11-21"), "not_sent")
})

test("day chips use the race weekend dates and skip time-slot grouping", () => {
  const chips = guestListDayChips("2026-12-06", ["3_day", "friday_only"])
  assert.equal(chips[0]?.id, "all")
  assert.deepEqual(
    chips.slice(1).map((chip) => chip.label),
    ["Friday 4 Dec", "Saturday 5 Dec", "Sunday 6 Dec"],
  )
  assert.equal(formatGuestListDayChipLabel("2026-12-04"), "Friday 4 Dec")
  assert.equal(seatAttendsDay(["friday_only"], "friday_only"), true)
  assert.equal(seatAttendsDay(["friday_only"], "sunday_only"), false)
  assert.equal(seatAttendsDay(["friday_only", "saturday_only", "sunday_only"], "saturday_only"), true)
})

test("ticket stats count posted as issued and tables by unique number", () => {
  const stats = guestListStats([
    { ticketStatus: "issued", paddockTour: "09:00", tableNumber: "12" },
    { ticketStatus: "posted", paddockTour: null, tableNumber: "12" },
    { ticketStatus: "pending", paddockTour: null, tableNumber: "8" },
    { ticketStatus: "pending", paddockTour: "10:00", tableNumber: null },
  ])
  assert.equal(stats.totalGuests, 4)
  assert.equal(stats.ticketsIssued, 2)
  assert.equal(stats.pendingIssue, 2)
  assert.equal(stats.paddockTourSlots, 2)
  assert.equal(stats.tablesInUse, 2)
})

test("unknown ticket statuses fall back to pending", () => {
  assert.equal(parseGuestTicketStatus("delivered"), "pending")
  assert.equal(parseGuestTicketStatus("issued"), "issued")
})

test("per-day supplier slices repeat on each race day instead of draining across the weekend", () => {
  const seats = assignSuppliersAcrossDays(
    [
      { slotIndex: 0, guest: null, supplierName: null, supplierDeadline: null, daySlots: ["friday_only"] },
      { slotIndex: 1, guest: null, supplierName: null, supplierDeadline: null, daySlots: ["friday_only"] },
      { slotIndex: 0, guest: null, supplierName: null, supplierDeadline: null, daySlots: ["saturday_only"] },
      { slotIndex: 1, guest: null, supplierName: null, supplierDeadline: null, daySlots: ["saturday_only"] },
    ],
    [{ name: "F1 Experiences", quantity: 2, deadline: "2026-11-20" }],
  )
  assert.equal(seats.length, 4)
  assert.equal(seats[0]?.supplierName, "F1 Experiences")
  assert.equal(seats[2]?.supplierName, "F1 Experiences")
  assert.equal(seats[2]?.daySlots[0], "saturday_only")
})

test("guest list lives on the product page tab and stores ops fields in SQL", () => {
  const sql = readFileSync(
    "supabase/migrations/20260911160000_package_guest_list_ops.sql",
    "utf8",
  )
  assert.match(sql, /ticket_status/)
  assert.match(sql, /paddock_tour/)
  assert.match(sql, /supplier_details_sent_at/)
  assert.match(sql, /delivery_method/)

  const link = readFileSync("lib/admin/package-link.ts", "utf8")
  assert.match(link, /guest-list/)
  const client = readFileSync("components/admin/package-detail-client.tsx", "utf8")
  assert.match(client, /Guest list/)
  assert.equal(client.includes("09:00 – 09:30 (8 guests)"), false)

  const ui = readFileSync("components/admin/package-guest-list.tsx", "utf8")
  assert.equal(ui.includes("09:00 – 09:30 (8 guests)"), false)
  assert.match(ui, /Guest details needed/)
})

test("product page tab query parses guest-list", async () => {
  const { parseAdminPackageTab, adminPackagePath } = await import("../lib/admin/package-link")
  assert.equal(parseAdminPackageTab("guest-list"), "guest-list")
  assert.match(adminPackagePath("pkg-1", "guest-list"), /tab=guest-list/)
})
