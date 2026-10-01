import assert from "node:assert/strict"
import test from "node:test"
import {
  ENQUIRY_BULK_TEMPLATE_CSV,
  markPackageDuplicates,
  parseEnquiryBulkCsv,
} from "../lib/crm/enquiry-bulk-upload"

const HEADERLESS = [
  "Ready to book now,2 Tickets,I'd like to discuss options first,Antros,Peralta,529991109448,jperaltacamargo@gmail.com",
  "Within the next few weeks,2 Tickets,\"Yes, that works for me\",Alex,Flores,526861910315,alexao.fv06@gmail.com",
  "Just exploring for now,1 Ticket,I'd like to discuss options first,Luis,Martinez,525562542976,luis.martinez@bxti.com.mx",
  "Within the next few weeks,3-4 Tickets,\"Yes, that works for me\",IGNACIO,ALVAREZ,525591970563,luisalavez77@gmail.com",
  "Ready to book now,5+ Tickets,I'd like to discuss options first,Ignacio Arias,Arias Iona,524621603184,nachoariaslona@gmail.com",
  "Ready to book now,2 Tickets,I'd like to discuss options first,Antros,Peralta,529991109448,jperaltacamargo@gmail.com",
].join("\n")

test("reads a headerless form export into enquiries", () => {
  const parsed = parseEnquiryBulkCsv(HEADERLESS)
  assert.equal(parsed.totalRows, 6)
  assert.equal(parsed.readyRows, 5)
  assert.equal(parsed.duplicateRows, 1)
  assert.equal(parsed.errorRows, 0)

  const first = parsed.rows[0]
  assert.equal(first?.fullName, "Antros Peralta")
  assert.equal(first?.email, "jperaltacamargo@gmail.com")
  assert.equal(first?.phone, "529991109448")
  assert.equal(first?.quantity, 2)
  assert.equal(first?.status, "ready")
  assert.match(first?.notes ?? "", /Historical form import/)
  assert.match(first?.notes ?? "", /Ready to book now/)
  assert.match(first?.notes ?? "", /discuss options first/)

  const range = parsed.rows[3]
  assert.equal(range?.fullName, "IGNACIO ALVAREZ")
  assert.equal(range?.quantity, 4)
  assert.equal(range?.ticketText, "3-4 Tickets")

  const plus = parsed.rows[4]
  assert.equal(plus?.fullName, "Ignacio Arias Arias Iona")
  assert.equal(plus?.quantity, 5)
  assert.equal(plus?.ticketText, "5+ Tickets")

  const duplicate = parsed.rows[5]
  assert.equal(duplicate?.status, "duplicate")
  assert.match(duplicate?.message ?? "", /earlier in this file/)
})

test("reads headed columns and keeps the form questions", () => {
  const parsed = parseEnquiryBulkCsv(
    [
      "When are you looking to book?,How many tickets are you interested in?,Would this work for you?,First name,Last name,Phone number,Email",
      "Just exploring for now,1 Ticket,I'd like to discuss options first,María,Manriquez,528115252646,karmen_mar@icloud.com",
    ].join("\n"),
  )
  assert.equal(parsed.readyRows, 1)
  const row = parsed.rows[0]
  assert.equal(row?.fullName, "María Manriquez")
  assert.equal(row?.quantity, 1)
  assert.equal(row?.email, "karmen_mar@icloud.com")
  assert.ok(row?.answers.some((answer) => answer.question.startsWith("When") && answer.answer.includes("exploring")))
  assert.ok(row?.answers.some((answer) => answer.answer.includes("discuss options")))
})

test("flags a broken email and a missing ticket count", () => {
  const parsed = parseEnquiryBulkCsv(
    [
      "First name,Last name,Email,Phone,Tickets",
      "Alex,Flores,not-an-email,526861910315,2",
      "Luis,Martinez,luis@example.com,525562542976,",
    ].join("\n"),
  )
  assert.equal(parsed.errorRows, 2)
  assert.match(parsed.rows[0]?.message ?? "", /Email is not valid/)
  assert.match(parsed.rows[1]?.message ?? "", /Ticket quantity is missing/)
})

test("marks people who already have this package", () => {
  const parsed = parseEnquiryBulkCsv(ENQUIRY_BULK_TEMPLATE_CSV)
  assert.equal(parsed.readyRows, 2)
  const marked = markPackageDuplicates(parsed.rows, {
    emails: new Set(["jperaltacamargo@gmail.com"]),
    phones: new Set(),
  })
  assert.equal(marked[0]?.status, "duplicate")
  assert.match(marked[0]?.message ?? "", /Already has an enquiry/)
  assert.equal(marked[1]?.status, "ready")
  assert.equal(marked[1]?.quantity, 4)
})
