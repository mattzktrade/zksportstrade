import assert from "node:assert/strict"
import test from "node:test"
import {
  ACCOUNT_BULK_MAX_ROWS,
  ACCOUNT_BULK_TEMPLATE_CSV,
  accountBulkKey,
  parseAccountBulkCsv,
  type BulkUploadDefaults,
} from "../lib/crm/account-bulk-upload"

const defaults: BulkUploadDefaults = {
  source: "marketing",
  accountTypes: ["travel_agency"],
  ownerProfileId: null,
}

test("parses the template with two contacts at one company and a nameless-company contact", () => {
  const parsed = parseAccountBulkCsv(ACCOUNT_BULK_TEMPLATE_CSV, defaults)
  assert.equal(parsed.totalRows, 3)
  assert.equal(parsed.validRows, 3)
  assert.equal(parsed.errorRows, 0)

  const company = parsed.rows[0]
  assert.equal(company?.accountName, "Apex Travel")
  assert.equal(company?.contactName, "Jane Smith")
  assert.equal(company?.email, "jane@apex.example")
  assert.deepEqual(company?.accountTypes, ["travel_agency"])
  assert.equal(company?.source, "marketing")
  assert.equal(company?.ownerProfileId, null)

  const second = parsed.rows[1]
  assert.equal(second?.accountName, "Apex Travel")
  assert.equal(second?.contactName, "Sam Lee")

  const person = parsed.rows[2]
  assert.equal(person?.accountName, "John Doe")
  assert.equal(person?.contactName, "John Doe")
  assert.deepEqual(person?.accountTypes, ["direct_client"])
  assert.ok(person?.warnings.some((warning) => warning.includes("direct client")))
})

test("builds a contact name from first and last columns when company is missing", () => {
  const csv = [
    "First name,Last name,Email",
    "Priya,Shah,priya@example.com",
  ].join("\n")
  const parsed = parseAccountBulkCsv(csv, defaults)
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.rows[0]?.contactName, "Priya Shah")
  assert.equal(parsed.rows[0]?.accountName, "Priya Shah")
  assert.deepEqual(parsed.rows[0]?.accountTypes, ["direct_client"])
})

test("rejects an invalid email and keeps the rest of the file", () => {
  const csv = [
    "Account name,Contact name,Email",
    "Apex Travel,Jane Smith,not-an-email",
    "Apex Travel,Sam Lee,sam@apex.example",
  ].join("\n")
  const parsed = parseAccountBulkCsv(csv, defaults)
  assert.equal(parsed.totalRows, 2)
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.errorRows, 1)
  assert.ok(parsed.rows[0]?.errors.some((error) => error.includes("Email")))
  assert.equal(parsed.rows[1]?.contactName, "Sam Lee")
})

test("maps common account-type and source aliases", () => {
  const csv = [
    "Organisation,Contact name,Account type,Source",
    "Summit Tickets,Alex Cole,Ticket agent,Campaign landing page",
  ].join("\n")
  const parsed = parseAccountBulkCsv(csv, {
    source: "manual",
    accountTypes: [],
    ownerProfileId: null,
  })
  assert.equal(parsed.validRows, 1)
  assert.deepEqual(parsed.rows[0]?.accountTypes, ["ticket_agent"])
  assert.equal(parsed.rows[0]?.source, "marketing")
  assert.equal(parsed.rows[0]?.accountName, "Summit Tickets")
})

test("requires a contact name", () => {
  const parsed = parseAccountBulkCsv("Account name,Email\nApex Travel,jane@apex.example", defaults)
  assert.equal(parsed.validRows, 0)
  assert.equal(parsed.errorRows, 1)
  assert.ok(parsed.rows[0]?.errors.some((error) => error.includes("Contact name")))
})

test("rejects files over the row cap", () => {
  const header = "Contact name,Email"
  const rows = Array.from({ length: ACCOUNT_BULK_MAX_ROWS + 1 }, (_, i) => `Person ${i},p${i}@example.com`)
  assert.throws(
    () => parseAccountBulkCsv([header, ...rows].join("\n"), defaults),
    /2000 rows or fewer/,
  )
})

test("groups the same company name onto one account key regardless of casing", () => {
  const csv = [
    "Account name,Contact name,Email",
    "Apex Travel,Jane Smith,jane@apex.example",
    "apex travel,Sam Lee,sam@apex.example",
    "APEX TRAVEL,Pat Cole,pat@apex.example",
  ].join("\n")
  const parsed = parseAccountBulkCsv(csv, defaults)
  assert.equal(parsed.validRows, 3)
  const keys = new Set(parsed.rows.map((row) => accountBulkKey(row.accountName)))
  assert.equal(keys.size, 1)
  assert.equal([...keys][0], "apex travel")
})

test("matches owner by staff name or email and errors on unknown owners", () => {
  const staff = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Reed",
      email: "alex@zk.example",
    },
  ]
  const withStaff = { ...defaults, staff }
  const csv = [
    "Account name,Contact name,Email,Owner",
    "Apex Travel,Jane Smith,jane@apex.example,Alex Reed",
    "Apex Travel,Sam Lee,sam@apex.example,alex@zk.example",
    "Summit Tickets,Pat Cole,pat@summit.example,Not A Person",
  ].join("\n")
  const parsed = parseAccountBulkCsv(csv, withStaff)
  assert.equal(parsed.validRows, 2)
  assert.equal(parsed.errorRows, 1)
  assert.equal(parsed.rows[0]?.ownerProfileId, staff[0].id)
  assert.equal(parsed.rows[0]?.ownerName, "Alex Reed")
  assert.equal(parsed.rows[1]?.ownerProfileId, staff[0].id)
  assert.ok(parsed.rows[2]?.errors.some((error) => error.includes("not a recognised staff member")))
})

test("uses the default owner when the Owner column is blank", () => {
  const staff = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alex Reed",
      email: "alex@zk.example",
    },
  ]
  const parsed = parseAccountBulkCsv(
    "Account name,Contact name,Email,Owner\nApex Travel,Jane Smith,jane@apex.example,",
    { ...defaults, staff, ownerProfileId: staff[0].id },
  )
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.rows[0]?.ownerProfileId, staff[0].id)
  assert.equal(parsed.rows[0]?.ownerName, "Alex Reed")
})
