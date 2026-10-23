import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  AED_PER_USD,
  FALLBACK_EUR_PER_USD,
  FALLBACK_GBP_PER_USD,
  assertBookingFormInvoiceCurrency,
  bookingBankDetailsForInvoiceCurrency,
  bookingFormSnapshotInvoiceLines,
  buildDealInvoiceReporting,
  catalogPriceInInvoiceCurrency,
  convertInvoiceAmountToUsd,
  convertInvoiceSalePrice,
  dealInvoiceCrmNote,
  dealInvoiceCurrencyIsLocked,
  dealLineEditorSalePrice,
  invoiceFromUsdAmount,
  invoiceFxRateFor,
  parseDealInvoiceCurrency,
  preparePricedInvoiceLine,
  usdFromInvoiceAmount,
} from "../lib/crm/deal-invoice-currency"
import {
  selectXeroInvoiceCurrency,
  selectXeroInvoiceCurrencyRate,
} from "../lib/integrations/xero/invoice-line-defaults"
import { applyBookingFormEdits, snapshotToEdits } from "../lib/booking-forms/edits"
import {
  BOOKING_ACKNOWLEDGEMENT,
  BOOKING_BANK_DETAILS,
  BOOKING_SELLER,
  BOOKING_TERMS,
} from "../lib/booking-forms/template"
import type { BookingFormSnapshot } from "../lib/booking-forms/types"

test("official peg converts entered AED to locked USD without reverse-rounding the invoice price", () => {
  const priced = preparePricedInvoiceLine(55087.5, "AED")
  assert.equal(priced.invoiceUnitPrice, 55087.5)
  assert.equal(priced.usdUnitPrice, usdFromInvoiceAmount(55087.5, "AED"))
  assert.equal(priced.usdUnitPrice, 15000)
  assert.equal(invoiceFromUsdAmount(15000, "AED"), 55087.5)
  assert.equal(catalogPriceInInvoiceCurrency(10000, "AED"), 36725)
  assert.equal(convertInvoiceSalePrice(36725, "AED", "USD"), 10000)
  assert.equal(invoiceFxRateFor("AED"), AED_PER_USD)
  assert.equal(invoiceFxRateFor("USD"), 1)
})

test("USD invoice amounts stay unchanged", () => {
  const priced = preparePricedInvoiceLine(12500.25, "USD")
  assert.equal(priced.invoiceUnitPrice, 12500.25)
  assert.equal(priced.usdUnitPrice, 12500.25)
  assert.equal(parseDealInvoiceCurrency("usd"), "USD")
  assert.equal(parseDealInvoiceCurrency("AED"), "AED")
  assert.equal(parseDealInvoiceCurrency("gbp"), "GBP")
  assert.equal(parseDealInvoiceCurrency("EUR"), "EUR")
  assert.equal(assertBookingFormInvoiceCurrency("GBP"), "GBP")
  assert.equal(assertBookingFormInvoiceCurrency("EUR"), "EUR")
  assert.throws(() => assertBookingFormInvoiceCurrency("SAR"), /USD, AED, GBP, or EUR/)
})

test("GBP and EUR convert at a locked invoice-per-USD rate", () => {
  const gbp = preparePricedInvoiceLine(7600, "GBP", FALLBACK_GBP_PER_USD)
  assert.equal(gbp.invoiceUnitPrice, 7600)
  assert.equal(gbp.usdUnitPrice, 10000)
  assert.equal(gbp.fxRate, FALLBACK_GBP_PER_USD)
  const eur = preparePricedInvoiceLine(8600, "EUR", FALLBACK_EUR_PER_USD)
  assert.equal(eur.usdUnitPrice, 10000)
  assert.equal(catalogPriceInInvoiceCurrency(10000, "GBP", 0.8), 8000)
  assert.equal(convertInvoiceSalePrice(8000, "GBP", "USD", { GBP: 0.8 }), 10000)
  assert.equal(convertInvoiceSalePrice(10000, "USD", "EUR", { EUR: 0.86 }), 8600)
})

test("CRM note is only shown for non-USD invoices", () => {
  assert.equal(
    dealInvoiceCrmNote({
      invoice_currency: "USD",
      invoice_total_amount: 15000,
      invoice_fx_rate: 1,
      total_amount: 15000,
    }),
    null,
  )
  const note = dealInvoiceCrmNote({
    invoice_currency: "AED",
    invoice_total_amount: 55087.5,
    invoice_fx_rate: AED_PER_USD,
    total_amount: 15000,
  })
  assert.match(note ?? "", /Invoiced in/)
  assert.match(note ?? "", /AED/)
  assert.match(note ?? "", /15,000/)
  assert.match(note ?? "", /was not a USD invoice/)
  const gbpNote = dealInvoiceCrmNote({
    invoice_currency: "GBP",
    invoice_total_amount: 7600,
    invoice_fx_rate: FALLBACK_GBP_PER_USD,
    total_amount: 10000,
  })
  assert.match(gbpNote ?? "", /£7,600/)
  assert.match(gbpNote ?? "", /10,000/)
})

test("editor sale price uses stored AED invoice amount", () => {
  assert.equal(
    dealLineEditorSalePrice({ unit_sale_price: 15000, invoice_unit_sale_price: 55087.5 }, "AED"),
    55087.5,
  )
  assert.equal(dealLineEditorSalePrice({ unit_sale_price: 15000, invoice_unit_sale_price: 15000 }, "USD"), 15000)
  assert.equal(
    dealLineEditorSalePrice({ unit_sale_price: 10000, invoice_unit_sale_price: 7600 }, "GBP"),
    7600,
  )
})

test("invoice currency locks after a booking form is sent", () => {
  assert.equal(dealInvoiceCurrencyIsLocked({ order_id: null, stage: "proposal" }), false)
  assert.equal(dealInvoiceCurrencyIsLocked({ order_id: null, stage: "awaiting_booking_form_send" }), false)
  assert.equal(dealInvoiceCurrencyIsLocked({ order_id: null, stage: "awaiting_client_signature" }), true)
  assert.equal(dealInvoiceCurrencyIsLocked({ order_id: "order-1", stage: "proposal" }), true)
})

test("AED bank details are listed first on AED documents", () => {
  const ordered = bookingBankDetailsForInvoiceCurrency("AED", BOOKING_BANK_DETAILS)
  assert.equal(ordered[0]?.currency, "AED")
  assert.ok(ordered.some((bank) => bank.currency === "USD"))
  assert.equal(bookingBankDetailsForInvoiceCurrency("GBP", BOOKING_BANK_DETAILS)[0]?.currency, "GBP")
  assert.equal(bookingBankDetailsForInvoiceCurrency("EUR", BOOKING_BANK_DETAILS)[0]?.currency, "EUR")
})

test("booking form edits recompute USD reporting from AED unit prices", () => {
  const snapshot: BookingFormSnapshot = {
    schemaVersion: 1,
    template: {
      key: "zk-standard-booking-form",
      version: 1,
      legalContentVersion: "2026-08-11",
    },
    documentRef: "ZK-TEST-AED",
    createdAt: "2026-10-22T12:00:00.000Z",
    deal: { id: "deal-1", title: "Abu Dhabi F1 GP 2026" },
    seller: BOOKING_SELLER,
    billTo: {
      accountId: "account-1",
      accountName: "Example Agent",
      contactId: "contact-1",
      contactName: "Example Signer",
      contactEmail: "signer@example.com",
      addressLines: ["Dubai"],
    },
    lines: [
      {
        dealLineItemId: "line-1",
        packageId: "package-1",
        eventName: "Abu Dhabi F1 GP 2026",
        packageName: "Paddock Club",
        description: "Paddock Club",
        quantity: 2,
        unitPrice: 55087.5,
        lineTotal: 110175,
        currency: "AED",
      },
    ],
    currency: "AED",
    subtotal: 110175,
    taxRate: 0,
    taxAmountIncluded: 0,
    total: 110175,
    reporting: buildDealInvoiceReporting({
      invoiceCurrency: "AED",
      lines: [{ dealLineItemId: "line-1", packageId: "package-1", quantity: 2, invoiceUnitPrice: 55087.5 }],
    }),
    paymentTerms: "AED 110175.00 (100.00%) due upon signing, all tax included.",
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
  }
  const edits = snapshotToEdits(snapshot)
  assert.equal(edits.currency, "AED")
  edits.lines[0].unitPrice = 36725
  const next = applyBookingFormEdits(snapshot, edits)
  assert.equal(next.currency, "AED")
  assert.equal(next.total, 73450)
  assert.equal(next.reporting?.currency, "USD")
  assert.equal(next.reporting?.fxRate, AED_PER_USD)
  assert.equal(next.reporting?.total, 20000)
})

test("Xero keeps AED invoices in AED and fails if the org lacks AED", () => {
  assert.equal(
    selectXeroInvoiceCurrency({
      invoiceCurrency: "AED",
      orgCurrencies: ["USD", "AED"],
      override: "USD",
    }),
    "AED",
  )
  assert.throws(
    () =>
      selectXeroInvoiceCurrency({
        invoiceCurrency: "AED",
        orgCurrencies: ["USD", "GBP"],
        override: "USD",
      }),
    /does not have AED enabled/,
  )
  assert.equal(
    selectXeroInvoiceCurrency({
      invoiceCurrency: "GBP",
      orgCurrencies: ["USD", "GBP", "EUR"],
      override: "USD",
    }),
    "GBP",
  )
  assert.throws(
    () =>
      selectXeroInvoiceCurrency({
        invoiceCurrency: "EUR",
        orgCurrencies: ["USD", "GBP"],
        override: "USD",
      }),
    /does not have EUR enabled/,
  )
  assert.equal(
    selectXeroInvoiceCurrency({
      invoiceCurrency: "USD",
      orgCurrencies: ["USD"],
      override: "USD",
    }),
    "USD",
  )
  assert.equal(
    selectXeroInvoiceCurrencyRate({
      invoiceCurrency: "AED",
      orgBaseCurrency: "USD",
      fxRate: AED_PER_USD,
    }),
    Math.round((1 / AED_PER_USD + Number.EPSILON) * 1_000_000) / 1_000_000,
  )
  assert.equal(
    selectXeroInvoiceCurrencyRate({
      invoiceCurrency: "AED",
      orgBaseCurrency: "GBP",
      fxRate: AED_PER_USD,
    }),
    undefined,
  )
  assert.equal(
    selectXeroInvoiceCurrencyRate({
      invoiceCurrency: "GBP",
      orgBaseCurrency: "USD",
      fxRate: 0.8,
    }),
    1.25,
  )
})

test("Xero paid or due amounts in AED convert to USD for CRM stats", () => {
  assert.equal(convertInvoiceAmountToUsd(3672.5, "AED", AED_PER_USD), 1000)
  assert.equal(convertInvoiceAmountToUsd(800, "GBP", 0.8), 1000)
  assert.equal(convertInvoiceAmountToUsd(860, "EUR", 0.86), 1000)
  assert.equal(convertInvoiceAmountToUsd(1000, "USD", 1), 1000)
})

test("signed AED booking forms write USD orders and AED invoices", () => {
  const sql = readFileSync("supabase/migrations/20261022140000_deal_invoice_currency.sql", "utf8")
  assert.match(sql, /v_invoice_currency not in \('USD', 'AED'\)/)
  assert.match(sql, /native_deal_orders_must_be_usd/)
  assert.match(sql, /reporting,total/)
  assert.match(sql, /v_invoice_total, v_invoice_currency/)
})

test("signed GBP and EUR booking forms are allowed on later order creation", () => {
  const sql = readFileSync("supabase/migrations/20261023100000_deal_invoice_gbp_eur.sql", "utf8")
  assert.match(sql, /v_invoice_currency not in \('USD', 'AED', 'GBP', 'EUR'\)/)
  assert.match(sql, /invoice_currency in \('USD', 'AED', 'GBP', 'EUR'\)/)
})

test("booking form snapshot lines keep invoice currency for Xero", () => {
  const lines = bookingFormSnapshotInvoiceLines({
    currency: "AED",
    lines: [
      {
        packageId: "package-1",
        description: "Paddock Club",
        quantity: 2,
        unitPrice: 55087.5,
        lineTotal: 110175,
        currency: "AED",
      },
    ],
  })
  assert.equal(lines?.[0]?.unit_price, 55087.5)
  assert.equal(lines?.[0]?.currency, "AED")
})
