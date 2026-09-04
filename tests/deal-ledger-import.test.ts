import assert from "node:assert/strict"
import test from "node:test"
import {
  DEAL_LEDGER_TEMPLATE_CSV,
  dealLedgerFailuresCsv,
  formatDealLedgerNote,
  mergeDealLedgerNotes,
  parseDealLedgerCsv,
  parseDealLedgerDate,
  parseDealLedgerStatus,
  planDealLedgerStageUpdate,
} from "../lib/crm/imports/deal-ledger"
import {
  matchDealLedgerRows,
  scoreLedgerName,
  type DealLedgerCandidate,
} from "../lib/crm/imports/deal-ledger-match"

function deal(overrides: Partial<DealLedgerCandidate> & { id: string; reference: string }): DealLedgerCandidate {
  return {
    accountName: "Wasserman Hospitality",
    contactName: "Jane Smith",
    stage: "awaiting_payment",
    totalAmount: 72000,
    expectedCloseDate: null,
    createdAt: "2026-01-06T10:00:00.000Z",
    ledgerInvoiceNumber: null,
    lines: [
      {
        packageId: "aus-lounge",
        packageName: "F1 Experiences Lounge",
        raceId: "aus",
        raceName: "Australian Grand Prix",
        raceShortName: "Australia",
        location: "Melbourne",
        country: "Australia",
        countryCode: "AU",
        season: 2026,
        eventDate: "2026-03-15",
        quantity: 12,
        unitSalePrice: 6000,
        supplierName: "EGP",
      },
    ],
    ...overrides,
  }
}

test("parses European deal dates from the master spreadsheet", () => {
  assert.equal(parseDealLedgerDate("23.12.25"), "2025-12-23")
  assert.equal(parseDealLedgerDate("06.01.26"), "2026-01-06")
  assert.equal(parseDealLedgerDate("21/01/26"), "2026-01-21")
  assert.equal(parseDealLedgerDate("2026-03-15"), "2026-03-15")
  assert.equal(parseDealLedgerDate(""), null)
})

test("maps PAID, UNPAID and CANCEL without treating other text as paid", () => {
  assert.equal(parseDealLedgerStatus("PAID"), "paid")
  assert.equal(parseDealLedgerStatus("unpaid"), "unpaid")
  assert.equal(parseDealLedgerStatus("CANCEL"), "cancelled")
  assert.equal(parseDealLedgerStatus("Cancelled"), "cancelled")
  assert.equal(parseDealLedgerStatus(""), null)
  assert.equal(parseDealLedgerStatus("HOLD"), "invalid")
})

test("parses a month-titled ledger with two DATE columns", () => {
  const csv = [
    "JANUARY",
    "No,DATE,CLIENT,EVENT,PRODUCT,QTY,SUPPLIER,AMOUNT,GROSSING,PROFIT,STATUS,DATE,CHANNEL,XE IN,INVOICE #",
    "1,23.12.25,Wasserman Hospitality Sales,Australia GP,F1 Experiences Lounge,12,EGP,72000,,,PAID,21/01/26,Bank,USD,INV-0857",
    "2,06.01.26,Seat Unique,China GP,Paddock Club Club Suite,20,Formula 1,115000,,,UNPAID,1/2026 27/02/,Amex Link,USD,INV-0883",
  ].join("\n")
  const parsed = parseDealLedgerCsv(csv)
  assert.equal(parsed.totalRows, 2)
  assert.equal(parsed.rows[0]?.client, "Wasserman Hospitality Sales")
  assert.equal(parsed.rows[0]?.dealDate, "2025-12-23")
  assert.equal(parsed.rows[0]?.paymentDate, "2026-01-21")
  assert.equal(parsed.rows[0]?.paymentStatus, "paid")
  assert.equal(parsed.rows[0]?.invoiceNumber, "INV-0857")
  assert.equal(parsed.rows[0]?.quantity, 12)
  assert.equal(parsed.rows[0]?.amount, 72000)
  assert.equal(parsed.rows[1]?.paymentStatus, "unpaid")
  assert.equal(parsed.rows[1]?.dealDate, "2026-01-06")
  assert.equal(parsed.rows[1]?.paymentDate, null)
})

test("parses the downloadable template", () => {
  const parsed = parseDealLedgerCsv(DEAL_LEDGER_TEMPLATE_CSV)
  assert.equal(parsed.validRows, 2)
  assert.equal(parsed.rows[0]?.invoiceNumber, "INV-0857")
  assert.equal(parsed.rows[1]?.paymentStatus, "unpaid")
})

test("does not invent a match when the client or event is missing from the portal", () => {
  const parsed = parseDealLedgerCsv(DEAL_LEDGER_TEMPLATE_CSV)
  const matched = matchDealLedgerRows(parsed, [
    deal({
      id: "d1",
      reference: "DL-1",
      accountName: "Another Agency",
    }),
  ])
  assert.equal(matched.validRows, 0)
  assert.ok(matched.rows[0]?.errors[0]?.includes("No deal matched"))
})

test("matches client nicknames, GP event labels and duplicate product words", () => {
  assert.ok(scoreLedgerName("Wasserman Hospitality Sales", "Wasserman Hospitality") >= 80)
  const parsed = parseDealLedgerCsv(
    [
      "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
      "23.12.25,Wasserman Hospitality Sales,Australia GP,Paddock Club Club Suite,4,48000,PAID,INV-0857",
    ].join("\n"),
  )
  const matched = matchDealLedgerRows(parsed, [
    deal({
      id: "d-suite",
      reference: "DL-SUITE",
      totalAmount: 48000,
      lines: [
        {
          packageId: "aus-suite",
          packageName: "Paddock Club Suite",
          raceId: "aus",
          raceName: "Australian Grand Prix",
          raceShortName: "Australia",
          location: "Melbourne",
          country: "Australia",
          countryCode: "AU",
          season: 2026,
          eventDate: "2026-03-15",
          quantity: 4,
          unitSalePrice: 12000,
          supplierName: "Formula 1",
        },
      ],
    }),
  ])
  assert.equal(matched.validRows, 1)
  assert.equal(matched.rows[0]?.dealId, "d-suite")
  assert.equal(matched.rows[0]?.dealReference, "DL-SUITE")
})

test("leaves ambiguous same-client rows off when qty and amount cannot separate them", () => {
  const parsed = parseDealLedgerCsv(
    [
      "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
      "23.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,12,72000,PAID,INV-0857",
    ].join("\n"),
  )
  const matched = matchDealLedgerRows(parsed, [
    deal({ id: "d1", reference: "DL-1" }),
    deal({ id: "d2", reference: "DL-2" }),
  ])
  assert.equal(matched.validRows, 0)
  assert.ok(matched.rows[0]?.errors[0]?.includes("Several deals"))
})

test("uses quantity and amount to pick one of two similar deals", () => {
  const parsed = parseDealLedgerCsv(
    [
      "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
      "23.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,4,24000,PAID,INV-0900",
    ].join("\n"),
  )
  const matched = matchDealLedgerRows(parsed, [
    deal({ id: "d12", reference: "DL-12", totalAmount: 72000 }),
    deal({
      id: "d4",
      reference: "DL-4",
      totalAmount: 24000,
      lines: [
        {
          packageId: "aus-lounge",
          packageName: "F1 Experiences Lounge",
          raceId: "aus",
          raceName: "Australian Grand Prix",
          raceShortName: "Australia",
          location: "Melbourne",
          country: "Australia",
          countryCode: "AU",
          season: 2026,
          eventDate: "2026-03-15",
          quantity: 4,
          unitSalePrice: 6000,
          supplierName: "EGP",
        },
      ],
    }),
  ])
  assert.equal(matched.validRows, 1)
  assert.equal(matched.rows[0]?.dealId, "d4")
})

test("does not assign the same portal deal to two spreadsheet rows", () => {
  const parsed = parseDealLedgerCsv(
    [
      "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
      "23.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,12,72000,PAID,INV-0857",
      "24.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,12,72000,UNPAID,INV-0858",
    ].join("\n"),
  )
  const matched = matchDealLedgerRows(parsed, [deal({ id: "only", reference: "DL-ONLY" })])
  const matchedIds = matched.rows.map((row) => row.dealId)
  assert.equal(matchedIds.filter(Boolean).length, 1)
  assert.equal(matched.errorRows, 1)
})

test("plans payment updates without crossing the stock-hold boundary", () => {
  assert.equal(planDealLedgerStageUpdate({ currentStage: "awaiting_payment", paymentStatus: "paid" }).action, "mark_paid")
  assert.equal(planDealLedgerStageUpdate({ currentStage: "paid_confirmed", paymentStatus: "paid" }).action, "none")
  assert.equal(planDealLedgerStageUpdate({ currentStage: "in_fulfilment", paymentStatus: "paid" }).action, "none")
  assert.equal(planDealLedgerStageUpdate({ currentStage: "paid_confirmed", paymentStatus: "unpaid" }).action, "mark_unpaid")
  assert.equal(
    planDealLedgerStageUpdate({ currentStage: "in_fulfilment", paymentStatus: "unpaid" }).action,
    "skip_status",
  )
  assert.equal(planDealLedgerStageUpdate({ currentStage: "proposal", paymentStatus: "paid" }).action, "skip_status")
  assert.equal(planDealLedgerStageUpdate({ currentStage: "awaiting_payment", paymentStatus: "cancelled" }).action, "skip_status")
  assert.equal(planDealLedgerStageUpdate({ currentStage: "draft", paymentStatus: "cancelled" }).action, "mark_cancelled")
})

test("builds a review spreadsheet for unmatched rows", () => {
  const csv = dealLedgerFailuresCsv(
    [
      {
        rawData: { CLIENT: "Unknown Ltd", EVENT: "Madrid GP", PRODUCT: "Lounge", STATUS: "PAID" },
        errors: ["No deal matched Unknown Ltd / Madrid GP / Lounge."],
        sheet: "JANUARY",
        sourceRow: 12,
      },
    ],
    ["CLIENT", "EVENT", "PRODUCT", "STATUS"],
  )
  assert.match(csv, /Unknown Ltd/)
  assert.match(csv, /Madrid GP/)
  assert.match(csv, /No deal matched/)
  assert.match(csv, /JANUARY/)
})

test("reads a second month header block in the same sheet", () => {
  const csv = [
    "JANUARY",
    "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
    "23.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,12,72000,PAID,INV-0857",
    "FEBRUARY",
    "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
    "06.01.26,Seat Unique,China GP,F1 Experiences Lounge,20,115000,UNPAID,INV-0883",
  ].join("\n")
  const parsed = parseDealLedgerCsv(csv)
  assert.equal(parsed.totalRows, 2)
  assert.equal(parsed.rows[1]?.client, "Seat Unique")
  assert.equal(parsed.rows[1]?.event, "China GP")
})

test("matches Madrid GP to a Madrid event name", () => {
  const parsed = parseDealLedgerCsv(
    [
      "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,INVOICE #",
      "06.01.26,Engage Group UK,Madrid GP,Gordon Ramsay at F1 Garage 3-Day,4,48000,PAID,INV-0910",
    ].join("\n"),
  )
  const matched = matchDealLedgerRows(parsed, [
    deal({
      id: "d-mad",
      reference: "DL-MAD",
      accountName: "Engage Group",
      totalAmount: 48000,
      lines: [
        {
          packageId: "mad-gr",
          packageName: "Gordon Ramsay at F1 Garage",
          raceId: "mad",
          raceName: "Madrid Grand Prix",
          raceShortName: "Madrid",
          location: "Madrid",
          country: "Spain",
          countryCode: "ES",
          season: 2026,
          eventDate: "2026-06-20",
          quantity: 4,
          unitSalePrice: 12000,
          supplierName: "F1E",
        },
      ],
    }),
  ])
  assert.equal(matched.validRows, 1)
  assert.equal(matched.rows[0]?.dealId, "d-mad")
})

test("reads MAW Comment, its date column, COMMENTS and payment channel into deal notes", () => {
  const csv = [
    "DATE,CLIENT,EVENT,PRODUCT,QTY,AMOUNT,STATUS,DATE,CHANNEL,XE IN,INVOICE #,COMMENTS,MAW Comment,",
    '23.12.25,Wasserman Hospitality,Australia GP,F1 Experiences Lounge,12,72000,PAID,21/01/26,Bank,USD,INV-0857,1st invoice - OIL,Payment recorded on Xero - receipt sent,21/01/2026',
  ].join("\n")
  const parsed = parseDealLedgerCsv(csv)
  const row = parsed.rows[0]
  assert.equal(row?.comments, "1st invoice - OIL")
  assert.equal(row?.financeNotes, "Payment recorded on Xero - receipt sent")
  assert.equal(row?.financeNoteDate, "2026-01-21")
  assert.equal(row?.channel, "Bank")
  assert.equal(
    row?.note,
    "Payment recorded on Xero - receipt sent (21/01/2026)\nPaid via Bank\n1st invoice - OIL",
  )
})

test("formats and merges finance notes without duplicating on a second apply", () => {
  assert.equal(
    formatDealLedgerNote({
      financeNotes: "Payment recorded on Xero - receipt sent",
      financeNoteDate: "2026-01-21",
      comments: null,
      channel: "Amex Link",
      paymentDate: "2026-01-21",
    }),
    "Payment recorded on Xero - receipt sent (21/01/2026)\nPaid via Amex Link",
  )
  const first = mergeDealLedgerNotes(null, "Paid via Bank")
  assert.equal(first, "Paid via Bank")
  assert.equal(mergeDealLedgerNotes(first, "Paid via Bank"), "Paid via Bank")
  assert.equal(mergeDealLedgerNotes(first, "Follow up sent"), "Paid via Bank\n\nFollow up sent")
})
