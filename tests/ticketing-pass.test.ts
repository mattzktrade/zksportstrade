import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { acceptedGuestFormHeadshotPath } from "../lib/guest-details/storage"
import { accentGuestName, displayTicketShortCode, guestHasHeadshot } from "../lib/tickets/pass"
import { validDayChipLabels } from "../lib/tickets/model"
import { buildTicketPdf } from "../lib/tickets/pdf"

test("guest pass names put the last word in the accent colour", () => {
  assert.deepEqual(accentGuestName("Matt Johnson"), { lead: "Matt", accent: "Johnson" })
  assert.deepEqual(accentGuestName("  Priya  "), { lead: "", accent: "Priya" })
  assert.deepEqual(accentGuestName(""), { lead: "", accent: "Guest" })
  assert.equal(guestHasHeadshot("staff/deal/a.jpg"), true)
  assert.equal(guestHasHeadshot("  "), false)
})

test("pass short code and day chips match the guest ticket layout", () => {
  assert.equal(displayTicketShortCode("ZK-1P45QT"), "ZK - 1P45QT")
  assert.deepEqual(validDayChipLabels(["friday_only", "saturday_only", "sunday_only"]), [
    "Friday",
    "Saturday",
    "Sunday",
  ])
})

test("public guest form keeps a staff headshot already on the guest row", () => {
  const existing = "staff/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/photo.jpg"
  assert.equal(acceptedGuestFormHeadshotPath(existing, "invite-1", existing), existing)
  assert.equal(acceptedGuestFormHeadshotPath("invite-1/new.jpg", "invite-1", existing), "invite-1/new.jpg")
  assert.equal(acceptedGuestFormHeadshotPath("other/hack.jpg", "invite-1", existing), null)
})

test("ticket PDF is a real one-page pass", async () => {
  const bytes = await buildTicketPdf({
    guestName: "Matt Johnson",
    eventLabel: "Abu Dhabi Grand Prix 2026",
    packageName: "Velocity Terrace",
    venue: "Yas Marina Circuit",
    days: ["friday_only", "saturday_only", "sunday_only"],
    shortCode: "ZK-ABC123",
    qrPayload: "ZK1.test.sig",
  })
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("utf8"), "%PDF-")
  const doc = await PDFDocument.load(bytes)
  assert.equal(doc.getPageCount(), 1)
  const page = doc.getPage(0)
  const { width, height } = page.getSize()
  assert.equal(width, 400)
  assert.equal(height, 840)
})
