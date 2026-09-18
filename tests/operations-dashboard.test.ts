import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isOperationsDashboardUser } from "../lib/admin/dashboard-audience"
import {
  OPERATIONS_DASHBOARD_TITLE,
  buildOperationsDashboardView,
  buildStockToBuy,
  compactOperationsDashboardCalendar,
  countryFlagUrl,
  operationsDashboardChipLabel,
  operationsPaymentRowStatus,
  shortRaceLabel,
  type OperationsDashboardBookingInput,
  type OperationsDashboardPurchaseOrderInput,
} from "../lib/admin/operations-dashboard-metrics"
import { DEFAULT_CHELLEY_CC, DEFAULT_OPERATIONS_CC } from "../lib/email/config"
import { isPurchaseOrderPaymentFilter } from "../lib/admin/purchase-order-payment"

function booking(
  overrides: Partial<OperationsDashboardBookingInput> = {},
): OperationsDashboardBookingInput {
  return {
    id: "booking-1",
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
    guestDetailsDeadline: "2026-09-20",
    deliveryDueAt: "2026-12-04",
    dealId: "deal-1",
    purchaseOrderIds: ["po-1"],
    reference: "ZK-1",
    xeroInvoiceNumber: "INV-1042",
    total: 245000,
    currency: "USD",
    amountDue: 0,
    overdueSince: null,
    ...overrides,
  }
}

function po(
  overrides: Partial<OperationsDashboardPurchaseOrderInput> = {},
): OperationsDashboardPurchaseOrderInput {
  return {
    id: "po-1",
    po_number: "PO-1",
    supplier: "Horizon Capital",
    guest_details_deadline: "2026-09-16",
    tickets_received_at: null,
    payment_due_date: "2026-09-10",
    paid_at: null,
    note: null,
    usage: {
      lines: [
        {
          packageName: "Paddock Club hospitality",
          eventName: "2026 Abu Dhabi Grand Prix",
          quantityPurchased: 10,
          unitCost: 18000,
          currency: "USD",
        },
      ],
    },
    ...overrides,
  }
}

test("operations dashboard is shown to Jenny, Chelley, and an operations role", () => {
  assert.equal(isOperationsDashboardUser({ role: "finance", email: DEFAULT_CHELLEY_CC }), true)
  assert.equal(isOperationsDashboardUser({ role: "sales", email: DEFAULT_OPERATIONS_CC }), true)
  assert.equal(isOperationsDashboardUser({ role: "sales", email: "other@zk-sports.com", full_name: "Jenny Kent" }), true)
  assert.equal(isOperationsDashboardUser({ role: "operations", email: "ops@zk-sports.com" }), true)
  assert.equal(isOperationsDashboardUser({ role: "admin", email: "matt@zk-sports.com" }), false)
  assert.equal(isOperationsDashboardUser({ role: "sales", email: "lara@zk-sports.com" }), false)
  assert.equal(isOperationsDashboardUser({ role: "finance", email: "finance@zk-sports.com" }), false)
})

test("operations dashboard uses live counts and links, not mock stats", () => {
  const today = "2026-09-18"
  const view = buildOperationsDashboardView({
    todayIso: today,
    now: new Date("2026-09-18T12:00:00.000Z"),
    bookings: [
      booking(),
      booking({
        id: "booking-2",
        accountName: "Velox Partners",
        invoiceStatus: "awaiting_payment",
        dealStage: "awaiting_payment",
        overdueSince: "2026-09-04",
        amountDue: 125000,
        deliveryDueAt: null,
        deliveryStatus: "delivered",
        fulfilmentStatus: "delivered",
        clientDeliveryMethod: "send_digital",
      }),
    ],
    purchaseOrders: [
      po(),
      po({
        id: "po-2",
        supplier: "Orion Group",
        guest_details_deadline: "2026-10-02",
        payment_due_date: "2026-09-20",
        usage: {
          lines: [
            {
              packageName: "Trackside branding",
              eventName: "2026 United States Grand Prix",
              quantityPurchased: 1,
              unitCost: 82500,
              currency: "USD",
            },
          ],
        },
      }),
    ],
    negativeStock: [
      { id: "ns-1", packageId: "pkg-1", packageName: "Paddock Club Lanyards", quantity: 24, eventDate: "2026-09-20" },
      { id: "ns-2", packageId: "pkg-1", packageName: "Paddock Club Lanyards", quantity: 2, eventDate: "2026-10-01" },
      { id: "ns-3", packageId: "pkg-2", packageName: "Event Programmes", quantity: 12, eventDate: "2026-11-01" },
    ],
    races: [
      {
        id: "abudhabi-2026",
        name: "Abu Dhabi Grand Prix",
        shortName: "Abu Dhabi Grand Prix",
        circuit: "Yas Marina Circuit",
        dateRange: "05 – 07 Dec 2026",
        eventDate: "2026-12-06",
        countryCode: "AE",
      },
      {
        id: "australia-2026",
        name: "Australian Grand Prix",
        circuit: "Albert Park Circuit",
        dateRange: "05 – 07 Mar 2026",
        eventDate: "2026-03-08",
        countryCode: "AU",
      },
    ],
  })

  assert.equal(view.title, OPERATIONS_DASHBOARD_TITLE)
  assert.equal(view.supplierDeadlinesDue, 1)
  assert.equal(view.overdueInvoiceCount, 1)
  assert.equal(view.negativeStock, 3)
  assert.equal(view.overdueSupplierPayments, 1)
  assert.equal(view.stockToBuy[0]?.name, "Paddock Club Lanyards")
  assert.equal(view.stockToBuy[0]?.current, -26)
  assert.equal(view.stockToBuy[0]?.need, 26)
  assert.equal(view.overdueInvoices[0]?.client, "Velox Partners")
  assert.equal(view.overdueInvoices[0]?.daysOverdue, 14)
  assert.equal(view.supplierPayments[0]?.status, "overdue")
  assert.equal(view.supplierPayments[1]?.status, "due_soon")
  assert.equal(view.upcomingRaces.length, 1)
  assert.equal(view.upcomingRaces[0]?.id, "abudhabi-2026")
  assert.equal(view.calendarItems.some((item) => item.kind === "supplier_payment"), true)
  assert.equal(view.calendarItems.some((item) => item.kind === "guest_deadline"), true)
  assert.doesNotMatch(JSON.stringify(view), /Emirates Corporate/)
})

test("dashboard calendar chips use short live labels and do not duplicate the same kind on one day", () => {
  assert.equal(shortRaceLabel("2026 Abu Dhabi Grand Prix"), "Abu Dhabi GP")
  assert.equal(operationsDashboardChipLabel({ kind: "collection" }), "Ticket delivery")
  const compacted = compactOperationsDashboardCalendar([
    { id: "a", date: "2026-09-18", kind: "collection", label: "Ticket delivery", href: "/admin/operations" },
    { id: "b", date: "2026-09-18", kind: "collection", label: "Ticket delivery", href: "/admin/operations" },
    { id: "c", date: "2026-09-18", kind: "race", label: "Abu Dhabi GP", href: "/admin/operations" },
  ])
  assert.equal(compacted.filter((item) => item.kind === "collection").length, 1)
  assert.equal(compacted.filter((item) => item.kind === "race").length, 1)
})

test("stock to purchase aggregates shortage rows by product", () => {
  const rows = buildStockToBuy([
    { id: "1", packageId: "a", packageName: "Caps", quantity: 8, eventDate: "2026-10-01" },
    { id: "2", packageId: "a", packageName: "Caps", quantity: 2, eventDate: "2026-09-20" },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.need, 10)
  assert.equal(rows[0]?.current, -10)
  assert.match(rows[0]?.href ?? "", /\/admin\/catalog\/a/)
})

test("due soon supplier payments are within seven days and paid orders are ignored", () => {
  const today = "2026-09-18"
  assert.equal(operationsPaymentRowStatus({ paid_at: "2026-09-01", payment_due_date: "2026-09-10" }, today), "paid")
  assert.equal(operationsPaymentRowStatus({ paid_at: null, payment_due_date: "2026-09-17" }, today), "overdue")
  assert.equal(operationsPaymentRowStatus({ paid_at: null, payment_due_date: "2026-09-25" }, today), "due_soon")
  assert.equal(operationsPaymentRowStatus({ paid_at: null, payment_due_date: "2026-10-10" }, today), "due")
  assert.equal(countryFlagUrl("AE"), "https://flagcdn.com/w40/ae.png")
  assert.equal(countryFlagUrl("USA"), null)
})

test("operations dashboard page is wired for Jenny/Chelley and deep-links stay live", () => {
  const page = readFileSync("app/(admin)/admin/page.tsx", "utf8")
  const ui = readFileSync("components/admin/operations-role-dashboard.tsx", "utf8")
  const metrics = readFileSync("lib/admin/operations-dashboard-metrics.ts", "utf8")
  assert.match(page, /isOperationsDashboardUser/)
  assert.match(page, /OperationsRoleDashboard/)
  assert.match(metrics, /Operations Dashboard/)
  assert.match(ui, /\{data\.title\}/)
  assert.match(ui, /\/admin\/inventory\/negative-stock/)
  assert.match(ui, /\/admin\/purchase-orders\?payment=overdue/)
  assert.match(ui, /\/admin\/finance\?status=overdue/)
  assert.match(ui, /Overdue invoices/)
  assert.doesNotMatch(ui, /Ticket deliveries due/)
  assert.match(ui, /\/admin\/operations\?tab=calendar/)
  assert.doesNotMatch(ui, /Horizon Capital/)
  assert.doesNotMatch(ui, /Paddock Club Lanyards/)
  assert.equal(isPurchaseOrderPaymentFilter("overdue"), true)
  assert.equal(isPurchaseOrderPaymentFilter("nope"), false)
})
