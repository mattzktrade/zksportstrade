import assert from "node:assert/strict"
import test from "node:test"
import {
  nativeStageForSalesforce,
  parseSalesforceCsv,
} from "../lib/crm/imports/salesforce-csv"
import { eventSeasonLabel } from "../lib/catalog/event-label"

test("parses Salesforce contact report aliases and quoted values", () => {
  const csv = [
    '"Contact: Contact ID","Contact: First Name","Contact: Last Name","Contact: Email","Account: Account Name"',
    '"003ABC","Jane","Smith","jane@example.com","Example Travel, Ltd"',
  ].join("\n")
  const parsed = parseSalesforceCsv(csv, "contacts")
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.errorRows, 0)
  assert.deepEqual(parsed.rows[0]?.normalizedData, {
    salesforceContactId: "003ABC",
    salesforceAccountId: null,
    accountName: "Example Travel, Ltd",
    accountType: "agent_company",
    contactName: "Jane Smith",
    email: "jane@example.com",
    phone: null,
    jobTitle: null,
    createdAt: null,
    updatedAt: null,
  })
})

test("accepts the standard contact export without Salesforce IDs", () => {
  const csv = [
    '"First Name","Last Name","Account Name","Title","Last Activity","Email","Phone","Mobile","Mailing State/Province","Mailing Country","Account Owner","Created Date"',
    '"Jinyane","Du","Ctrip Travel Holding (Hong Kong) Limited","Product Manager","","jinyane@example.com","","+44 7000 000000","","China","Michael Zahornacky","08/12/2026"',
  ].join("\n")
  const parsed = parseSalesforceCsv(csv, "contacts")
  assert.equal(parsed.validRows, 1)
  assert.equal(parsed.errorRows, 0)
  assert.equal(parsed.rows[0]?.normalizedData.salesforceContactId, null)
  assert.equal(parsed.rows[0]?.normalizedData.accountName, "Ctrip Travel Holding (Hong Kong) Limited")
  assert.equal(parsed.rows[0]?.normalizedData.contactName, "Jinyane Du")
  assert.equal(parsed.rows[0]?.normalizedData.phone, "+44 7000 000000")
  assert.ok(parsed.rows[0]?.warnings.some((warning) => warning.includes("generate its own ID")))
})

test("maps Closed Won opportunities without requesting stock changes", () => {
  const csv = [
    '"Opportunity ID","Opportunity Name","Account Name","Stage","Is Won","Amount","Opportunity Product ID","Product ID","Quantity","Sales Price"',
    '"006ABC","Monaco sale","Example Travel","Closed Won","TRUE","25000","00kABC","01tABC","2","12500"',
  ].join("\n")
  const parsed = parseSalesforceCsv(csv, "opportunities")
  const row = parsed.rows[0]
  assert.equal(parsed.validRows, 1)
  assert.equal(row?.normalizedData.nativeStage, "paid_confirmed")
  assert.equal(row?.normalizedData.isWon, true)
  assert.equal(row?.normalizedData.quantity, 2)
  assert.equal(row?.normalizedData.unitPrice, 12500)
  assert.ok(row?.warnings.some((warning) => warning.includes("stock reconciliation")))
})

test("requires stable opportunity and account identifiers", () => {
  const parsed = parseSalesforceCsv(
    '"Opportunity Name","Stage"\n"Unknown enquiry","Qualification"',
    "opportunities",
  )
  assert.equal(parsed.validRows, 0)
  assert.equal(parsed.errorRows, 1)
  assert.equal(parsed.rows[0]?.errors.length, 2)
})

test("maps common Salesforce stages into simplified native stages", () => {
  assert.equal(nativeStageForSalesforce("Qualification", false, false), "draft")
  assert.equal(nativeStageForSalesforce("Proposal / Price Quote", false, false), "proposal")
  assert.equal(nativeStageForSalesforce("Booking Form Sent", false, false), "awaiting_client_signature")
  assert.equal(nativeStageForSalesforce("Closed Lost", false, true), "closed_lost")
  assert.equal(nativeStageForSalesforce("Closed Won", true, true), "paid_confirmed")
})

test("event labels always distinguish the season", () => {
  assert.equal(eventSeasonLabel("Abu Dhabi Grand Prix", 2026), "2026 Abu Dhabi Grand Prix")
  assert.equal(eventSeasonLabel("2027 Abu Dhabi Grand Prix", 2027), "2027 Abu Dhabi Grand Prix")
})

