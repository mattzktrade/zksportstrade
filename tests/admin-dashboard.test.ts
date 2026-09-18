import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ADMIN_DASHBOARD_TITLE,
  buildAdminDashboardView,
  chartTicks,
  formatCompactAxis,
  isAwaitingFulfilment,
  isConfirmedSale,
  isOverdueInvoice,
  dealNumberLabel,
  lastNMonthKeys,
  monthLabelFromKey,
  niceChartMax,
  percentChange,
  pickReportingCurrency,
  salesRepLabel,
  shiftMonthKey,
  type DashboardSaleRow,
} from "../lib/admin/admin-dashboard-metrics"
import { isFinanceStatusFilter } from "../lib/admin/workflow-status"

function sale(overrides: Partial<DashboardSaleRow> & { grossProfit?: number | null } = {}): DashboardSaleRow & {
  grossProfit?: number | null
} {
  return {
    id: overrides.id ?? "row-1",
    dealId: overrides.dealId ?? "deal-1",
    reference: overrides.reference ?? "ZK-2026-1",
    dealReference: overrides.dealReference ?? "DL1001",
    accountName: overrides.accountName ?? "Horizon Capital",
    eventPackage: overrides.eventPackage ?? "Monaco GP 2026 · Garage Club",
    total: overrides.total ?? 180000,
    currency: overrides.currency ?? "GBP",
    createdAt: overrides.createdAt ?? "2026-09-10T12:00:00.000Z",
    paidAt: overrides.paidAt ?? "2026-09-10T12:00:00.000Z",
    ownerName: overrides.ownerName ?? "Lara Ahmed",
    orderStatus: overrides.orderStatus ?? "confirmed",
    invoiceStatus: overrides.invoiceStatus ?? "paid",
    dealStage: overrides.dealStage ?? "paid_confirmed",
    fulfilmentStatus: overrides.fulfilmentStatus ?? "confirmed",
    overdueSince: overrides.overdueSince ?? null,
    amountDue: overrides.amountDue ?? 0,
    grossProfit: overrides.grossProfit ?? 36000,
  }
}

test("admin dashboard is titled Dashboard, not Directors Dashboard", () => {
  assert.equal(ADMIN_DASHBOARD_TITLE, "Dashboard")
  const page = readFileSync("app/(admin)/admin/page.tsx", "utf8")
  const ui = readFileSync("components/admin/admin-role-dashboard.tsx", "utf8")
  assert.match(page, /isOperationsDashboardUser/)
  assert.match(page, /OperationsRoleDashboard/)
  assert.match(page, /profile\.role === "admin"/)
  assert.match(page, /AdminRoleDashboard/)
  assert.match(page, /isSalesDashboardUser/)
  assert.match(page, /SalesRoleDashboard/)
  assert.match(page, /StaffDashboard/)
  assert.doesNotMatch(page, /Directors Dashboard/)
  assert.doesNotMatch(ui, /Directors Dashboard/)
  assert.match(ui, /Pending users/)
  assert.match(ui, /Booking forms awaiting approval/)
  assert.match(ui, /Approvals & action needed/)
  assert.doesNotMatch(ui, /Pending user approvals/)
  assert.match(ui, /Recent confirmed deals/)
  assert.doesNotMatch(ui, /Key numbers at a glance/)
  assert.match(ui, />Deal</)
  assert.doesNotMatch(ui, /Sales rep/)
})

test("finance overdue dashboard links open the matching finance filter", () => {
  const ui = readFileSync("components/admin/admin-role-dashboard.tsx", "utf8")
  const finance = readFileSync("app/(admin)/admin/finance/page.tsx", "utf8")
  assert.match(ui, /\/admin\/finance\?status=overdue/)
  assert.match(finance, /initialStatus/)
  assert.match(finance, /isFinanceStatusFilter/)
  assert.equal(isFinanceStatusFilter("overdue"), true)
  assert.equal(isFinanceStatusFilter("awaiting_payment"), true)
  assert.equal(isFinanceStatusFilter("nope"), false)
})

test("sales rep names shorten to first initial and last name", () => {
  assert.equal(salesRepLabel("Lara Ahmed"), "L. Ahmed")
  assert.equal(salesRepLabel("Matt"), "Matt")
  assert.equal(salesRepLabel("  "), "—")
  assert.equal(salesRepLabel(null), "—")
})

test("deal number prefers the DL reference over the order number", () => {
  assert.equal(dealNumberLabel({ dealReference: "DL88", reference: "ZK-2026-1" }), "DL88")
  assert.equal(dealNumberLabel({ dealReference: null, reference: "ZK-2026-1" }), "ZK-2026-1")
  assert.equal(dealNumberLabel({ dealReference: "  ", reference: "" }), "—")
})

test("percent change hides a zero-to-zero comparison and rounds real movement", () => {
  assert.equal(percentChange(0, 0), null)
  assert.equal(percentChange(112, 100), 12)
  assert.equal(percentChange(80, 100), -20)
  assert.equal(percentChange(50, 0), 100)
})

test("reporting currency follows the largest confirmed book", () => {
  assert.equal(
    pickReportingCurrency([
      { currency: "USD", total: 100 },
      { currency: "GBP", total: 500 },
      { currency: "gbp", total: 10 },
    ]),
    "GBP",
  )
  assert.equal(pickReportingCurrency([]), "GBP")
})

test("last six months run through the current month", () => {
  assert.deepEqual(lastNMonthKeys(6, "2026-09"), [
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ])
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12")
  assert.equal(monthLabelFromKey("2026-09"), "Sep 2026")
})

test("confirmed sales exclude unpaid invoices and cancelled rows", () => {
  assert.equal(isConfirmedSale(sale()), true)
  assert.equal(isConfirmedSale(sale({ dealStage: "awaiting_payment", invoiceStatus: "awaiting_payment" })), false)
  assert.equal(isConfirmedSale(sale({ orderStatus: "cancelled", dealStage: "cancelled" })), false)
  assert.equal(isOverdueInvoice(sale({ invoiceStatus: "awaiting_payment", overdueSince: "2026-09-01", dealStage: "awaiting_payment" })), true)
  assert.equal(isAwaitingFulfilment(sale({ invoiceStatus: "paid", dealStage: "paid_confirmed" })), true)
  assert.equal(isAwaitingFulfilment(sale({ invoiceStatus: "delivered", fulfilmentStatus: "delivered" })), false)
})

test("admin dashboard model uses live confirmed sales and open pipeline", () => {
  const view = buildAdminDashboardView({
    now: new Date("2026-09-18T12:00:00.000Z"),
    pendingUsers: 3,
    paddockRequests: 12,
    bookingFormsAwaiting: 7,
    bookingFormsHref: "/admin/deals?pipeline=awaiting_approval",
    negativeStock: 2,
    activeHolds: 10,
    workflowRows: [
      sale({
        id: "sep-1",
        total: 245000,
        grossProfit: 49000,
        paidAt: "2026-09-12T12:00:00.000Z",
        accountName: "Emirates Corporate",
        ownerName: "Sarah Carter",
      }),
      sale({
        id: "aug-1",
        total: 200000,
        grossProfit: 40000,
        createdAt: "2026-08-10T12:00:00.000Z",
        paidAt: "2026-08-10T12:00:00.000Z",
      }),
      sale({
        id: "unpaid",
        total: 90000,
        invoiceStatus: "awaiting_payment",
        dealStage: "awaiting_payment",
        overdueSince: "2026-09-01",
        amountDue: 90000,
        paidAt: null,
      }),
    ],
    pipelineDeals: [
      { stage: "proposal", total_amount: 4_000_000, currency: "GBP" },
      { stage: "awaiting_payment", total_amount: 32701, currency: "GBP" },
      { stage: "paid_confirmed", total_amount: 999999, currency: "GBP" },
    ],
  })

  assert.equal(view.title, "Dashboard")
  assert.equal(view.pendingUsers, 3)
  assert.equal(view.paddockRequests, 12)
  assert.equal(view.bookingFormsAwaiting, 7)
  assert.equal(view.revenue, 245000)
  assert.equal(view.profit, 49000)
  assert.equal(view.confirmedDeals, 1)
  assert.equal(view.revenueChange, 23)
  assert.equal(view.overdueInvoices, 1)
  assert.equal(view.outstandingInvoices, 1)
  assert.equal(view.outstandingValue, 90000)
  assert.equal(view.pipelineValue, 4_032_701)
  assert.equal(view.months.length, 6)
  assert.equal(view.months[5]?.key, "2026-09")
  assert.equal(view.recentDeals[0]?.dealNumber, "DL1001")
  assert.equal(view.recentDeals[0]?.client, "Emirates Corporate")
  assert.equal(view.recentDeals[0]?.href, "/admin/deals/deal-1")
})

test("chart axis uses a round ceiling and compact currency labels", () => {
  assert.equal(niceChartMax(1_108_417), 2_000_000)
  assert.deepEqual(chartTicks(2_000_000), [0, 500000, 1000000, 1500000, 2000000])
  assert.equal(formatCompactAxis(2_000_000, "GBP"), "£2.0M")
  assert.equal(formatCompactAxis(500000, "GBP"), "£500k")
})
