import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isSalesDashboardUser } from "../lib/admin/dashboard-audience"
import {
  SALES_DASHBOARD_TITLE,
  SALES_PIPELINE_ROWS,
  UNASSIGNED_ENQUIRIES_HREF,
  buildSalesDashboardView,
  isUnassignedNewEnquiry,
  salesActivityKind,
  salesChartHasValues,
  salesPipelineRowId,
  type SalesDashboardDeal,
  type SalesDashboardSale,
} from "../lib/admin/sales-dashboard-metrics"

const OWNER = "lara-id"
const OTHER = "other-id"

function deal(overrides: Partial<SalesDashboardDeal> = {}): SalesDashboardDeal {
  return {
    id: overrides.id ?? "deal-1",
    reference: overrides.reference ?? "DL1001",
    stage: overrides.stage ?? "draft",
    enquiry_stage: overrides.enquiry_stage ?? "new",
    source: overrides.source ?? "website",
    owner_profile_id: overrides.owner_profile_id === undefined ? OWNER : overrides.owner_profile_id,
    total_amount: overrides.total_amount ?? 25000,
    currency: overrides.currency ?? "GBP",
    created_at: overrides.created_at ?? "2026-09-10T12:00:00.000Z",
    race_name: overrides.race_name ?? "Singapore Grand Prix 2026",
    line_summary: overrides.line_summary ?? "Paddock Club",
    recent_activities: overrides.recent_activities ?? [],
  }
}

function sale(overrides: Partial<SalesDashboardSale> = {}): SalesDashboardSale {
  return {
    id: overrides.id ?? "row-1",
    dealId: overrides.dealId ?? "won-1",
    reference: overrides.reference ?? "ZK-2026-1",
    dealReference: overrides.dealReference ?? "DL2001",
    accountName: overrides.accountName ?? "Apex Group",
    eventPackage: overrides.eventPackage ?? "Monaco GP 2026 · Paddock Club",
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
    ownerId: overrides.ownerId === undefined ? OWNER : overrides.ownerId,
  }
}

test("sales dashboard is shown to sales staff, not admin or finance", () => {
  assert.equal(isSalesDashboardUser({ role: "sales" }), true)
  assert.equal(isSalesDashboardUser({ role: "admin" }), false)
  assert.equal(isSalesDashboardUser({ role: "finance" }), false)
  assert.equal(isSalesDashboardUser({ role: "operations" }), false)
})

test("unassigned new enquiries exclude owned and later enquiry stages", () => {
  assert.equal(isUnassignedNewEnquiry(deal({ owner_profile_id: null })), true)
  assert.equal(isUnassignedNewEnquiry(deal({ owner_profile_id: OWNER })), false)
  assert.equal(
    isUnassignedNewEnquiry(deal({ owner_profile_id: null, enquiry_stage: "contacted" })),
    false,
  )
  assert.equal(
    isUnassignedNewEnquiry(
      deal({ owner_profile_id: null, stage: "awaiting_booking_form_send", enquiry_stage: "new" }),
    ),
    false,
  )
})

test("pipeline row ids follow Enquiries then Deals, not mock CRM stages", () => {
  assert.equal(salesPipelineRowId(deal({ stage: "draft", enquiry_stage: "price_sent" })), "price_sent")
  assert.equal(salesPipelineRowId(deal({ stage: "awaiting_booking_form_send" })), "ready_to_send")
  assert.equal(salesPipelineRowId(deal({ stage: "awaiting_client_signature" })), "booking_form")
  assert.equal(salesPipelineRowId(deal({ stage: "paid_confirmed" })), "won")
  assert.equal(salesPipelineRowId(deal({ stage: "closed_lost" })), "lost")
  assert.equal(
    SALES_PIPELINE_ROWS.some((row) => row.label === "Meeting Scheduled"),
    false,
  )
  assert.ok(SALES_PIPELINE_ROWS.some((row) => row.id === "sourcing_required"))
  assert.ok(SALES_PIPELINE_ROWS.some((row) => row.id === "ready_to_send"))
})

test("sales dashboard uses the salesperson's live records only", () => {
  const view = buildSalesDashboardView({
    ownerId: OWNER,
    now: new Date("2026-09-18T12:00:00.000Z"),
    deals: [
      deal({
        id: "unassigned-1",
        reference: "DL0847",
        owner_profile_id: null,
        created_at: "2026-09-14T10:00:00.000Z",
        recent_activities: [
          { id: "act-new", summary: "Website enquiry received", created_at: "2026-09-14T10:00:00.000Z", actor_name: null },
        ],
      }),
      deal({
        id: "unassigned-old",
        reference: "DL0840",
        owner_profile_id: null,
        enquiry_stage: "contacted",
        created_at: "2026-09-12T10:00:00.000Z",
      }),
      deal({
        id: "mine-new",
        reference: "DL0900",
        enquiry_stage: "new",
        total_amount: 12000,
        created_at: "2026-09-08T10:00:00.000Z",
      }),
      deal({
        id: "mine-price",
        reference: "DL0901",
        stage: "proposal",
        enquiry_stage: "price_sent",
        total_amount: 40000,
        created_at: "2026-08-20T10:00:00.000Z",
        recent_activities: [
          { id: "act-price", summary: "Price sent to Apex Group", created_at: "2026-09-18T08:00:00.000Z", actor_name: "Lara Ahmed" },
        ],
      }),
      deal({
        id: "mine-ready",
        reference: "DL0902",
        stage: "awaiting_booking_form_send",
        enquiry_stage: null,
        total_amount: 55000,
        created_at: "2026-09-02T10:00:00.000Z",
      }),
      deal({
        id: "mine-won",
        reference: "DL2001",
        stage: "paid_confirmed",
        enquiry_stage: null,
        total_amount: 180000,
      }),
      deal({
        id: "mine-lost",
        reference: "DL1999",
        stage: "closed_lost",
        enquiry_stage: null,
        total_amount: 90000,
      }),
      deal({
        id: "other-open",
        reference: "DL3000",
        owner_profile_id: OTHER,
        stage: "proposal",
        enquiry_stage: "follow_up",
        total_amount: 999999,
      }),
    ],
    sales: [
      sale(),
      sale({
        id: "row-aug",
        dealId: "won-aug",
        total: 100000,
        createdAt: "2026-08-12T12:00:00.000Z",
        paidAt: "2026-08-12T12:00:00.000Z",
      }),
      sale({
        id: "row-other",
        ownerId: OTHER,
        total: 500000,
        dealId: "other-won",
      }),
    ],
  })

  assert.equal(view.title, "Sales Dashboard")
  assert.equal(view.unassignedCount, 1)
  assert.equal(view.unassigned[0]?.reference, "DL0847")
  assert.equal(view.unassigned[0]?.source, "Website")
  assert.match(view.unassigned[0]?.interest ?? "", /Singapore/)
  assert.equal(view.unassignedHref, UNASSIGNED_ENQUIRIES_HREF)
  assert.equal(view.revenue, 180000)
  assert.equal(view.confirmedDeals, 1)
  assert.equal(view.revenueChange, 80)
  assert.equal(view.pipelineValue, 12000 + 40000 + 55000)
  assert.equal(view.opportunityCount, 3)
  assert.equal(view.conversionRate, 50)
  assert.equal(view.pipelineRows.find((row) => row.id === "new")?.count, 1)
  assert.equal(view.pipelineRows.find((row) => row.id === "price_sent")?.count, 1)
  assert.equal(view.pipelineRows.find((row) => row.id === "ready_to_send")?.count, 1)
  assert.equal(view.pipelineRows.find((row) => row.id === "won")?.count, 1)
  assert.equal(view.pipelineRows.find((row) => row.id === "lost")?.count, 1)
  assert.equal(view.pipelineRows.find((row) => row.id === "follow_up")?.count, 0)
  assert.equal(view.months.find((month) => month.key === "2026-09")?.sales, 180000)
  assert.equal(view.months.find((month) => month.key === "2026-09")?.pipeline, 12000 + 55000)
  assert.equal(view.months.find((month) => month.key === "2026-08")?.pipeline, 40000)
  assert.equal(view.recentActivity[0]?.kind, "proposal")
  assert.match(view.recentActivity[0]?.summary ?? "", /Price sent/)
  assert.equal(salesActivityKind("Proposal sent for Monaco GP 2026"), "proposal")
})

test("conversion is omitted when the salesperson has no won or closed-lost deals", () => {
  const view = buildSalesDashboardView({
    ownerId: OWNER,
    now: new Date("2026-09-18T12:00:00.000Z"),
    deals: [deal({ enquiry_stage: "contacted", total_amount: 10000 })],
    sales: [],
  })
  assert.equal(view.conversionRate, null)
  assert.equal(view.revenue, 0)
  assert.equal(view.unassignedCount, 0)
  assert.equal(view.pipelineValue, 10000)
})

test("empty monthly performance hides the fake £2M chart scale", () => {
  assert.equal(salesChartHasValues([]), false)
  assert.equal(salesChartHasValues([{ sales: 0, pipeline: 0 }]), false)
  assert.equal(salesChartHasValues([{ sales: 0, pipeline: 12000 }]), true)
  const empty = buildSalesDashboardView({
    ownerId: OWNER,
    now: new Date("2026-09-18T12:00:00.000Z"),
    deals: [],
    sales: [],
  })
  assert.equal(salesChartHasValues(empty.months), false)
  const ui = readFileSync("components/admin/sales-role-dashboard.tsx", "utf8")
  assert.match(ui, /No confirmed sales or new pipeline in the last 6 months/)
  assert.match(ui, /salesChartHasValues/)
  assert.match(ui, /minmax\(0,1fr\)/)
  assert.doesNotMatch(ui, /No prior month to compare/)
})

test("sales dashboard page is wired for sales staff and uses live ZK stages", () => {
  const page = readFileSync("app/(admin)/admin/page.tsx", "utf8")
  const ui = readFileSync("components/admin/sales-role-dashboard.tsx", "utf8")
  const metrics = readFileSync("lib/admin/sales-dashboard-metrics.ts", "utf8")
  const enquiries = readFileSync("app/(admin)/admin/enquiries/page.tsx", "utf8")
  const enquiriesClient = readFileSync("app/(admin)/admin/enquiries/enquiries-client.tsx", "utf8")
  assert.match(page, /isSalesDashboardUser/)
  assert.match(page, /SalesRoleDashboard/)
  assert.match(metrics, /Sales Dashboard/)
  assert.match(metrics, /\/admin\/enquiries\?stage=new&owner=unassigned/)
  assert.match(ui, /\{data\.title\}/)
  assert.match(ui, /New unassigned enquiries/)
  assert.match(ui, /Won vs closed lost/)
  assert.match(ui, /Your monthly performance/)
  assert.match(ui, /row\.group === "enquiry" \? "Enquiries" : "Deals"/)
  assert.ok(SALES_PIPELINE_ROWS.some((row) => row.label === "Sourcing required"))
  assert.ok(SALES_PIPELINE_ROWS.some((row) => row.label === "Ready to send"))
  assert.doesNotMatch(ui, /Meeting Scheduled/)
  assert.doesNotMatch(ui, /Horizon Capital/)
  assert.doesNotMatch(ui, /L-2026-0847/)
  assert.match(enquiries, /owner\?: string/)
  assert.match(enquiriesClient, /initialOwnerFilter/)
})
