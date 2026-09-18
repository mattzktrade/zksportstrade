import {
  confirmationStamp,
  currentMonthKeyUtc,
  dashboardTodayLabel,
  isConfirmedSale,
  lastNMonthKeys,
  monthKeyUtc,
  monthLabelFromKey,
  percentChange,
  pickReportingCurrency,
  shiftMonthKey,
  type DashboardSaleRow,
} from "@/lib/admin/admin-dashboard-metrics"
import {
  DEAL_BOARD_COLUMNS,
  ENQUIRY_CRM_STAGE_LABELS,
  ENQUIRY_CRM_STAGES,
  adminRecordWorkspacePath,
  dealBoardColumnFor,
  enquiryCrmStageFromDeal,
  enquiryInterestLabel,
  isEnquiryPipelineStage,
  type DealBoardPipelineId,
  type EnquiryCrmStage,
} from "@/lib/crm/deal-pipeline"
import {
  canonicalDealStage,
  dealSourceLabel,
  dealStageIsConfirmed,
  dealStageIsOpenPipeline,
  friendlyDealActivitySummary,
} from "@/lib/crm/deal-types"

export const SALES_DASHBOARD_TITLE = "Sales Dashboard"
export const SALES_DASHBOARD_DESCRIPTION =
  "Your enquiries, pipeline and sales performance at a glance."

export const UNASSIGNED_ENQUIRIES_HREF = "/admin/enquiries?stage=new&owner=unassigned"

export type SalesPipelineRowId = EnquiryCrmStage | DealBoardPipelineId

export const SALES_PIPELINE_ROWS: ReadonlyArray<{
  id: SalesPipelineRowId
  label: string
  href: string
  group: "enquiry" | "deal"
}> = [
  ...ENQUIRY_CRM_STAGES.map((id) => ({
    id,
    label: ENQUIRY_CRM_STAGE_LABELS[id],
    href: `/admin/enquiries?stage=${id}`,
    group: "enquiry" as const,
  })),
  ...DEAL_BOARD_COLUMNS.map((column) => ({
    id: column.id,
    label: column.label,
    href: `/admin/deals?pipeline=${column.id}`,
    group: "deal" as const,
  })),
]

export type SalesDashboardSale = DashboardSaleRow & {
  ownerId: string | null
  grossProfit?: number | null
}

export type SalesDashboardDeal = {
  id: string
  reference: string
  stage: string
  enquiry_stage: string | null
  source: string | null
  owner_profile_id: string | null
  total_amount: number
  currency: string
  created_at: string
  race_name: string | null
  line_summary: string | null
  recent_activities: Array<{
    id: string
    summary: string
    created_at: string
    actor_name: string | null
  }>
}

export type SalesMonthBucket = {
  key: string
  label: string
  sales: number
  pipeline: number
  deals: number
}

export function salesChartHasValues(months: Array<Pick<SalesMonthBucket, "sales" | "pipeline">>): boolean {
  return months.some((month) => month.sales > 0 || month.pipeline > 0)
}

export type SalesDashboardPipelineRow = {
  id: SalesPipelineRowId
  label: string
  href: string
  group: "enquiry" | "deal"
  count: number
}

export type SalesDashboardUnassigned = {
  id: string
  href: string
  reference: string
  interest: string
  source: string
  receivedAt: string
}

export type SalesActivityKind =
  | "email"
  | "call"
  | "proposal"
  | "booking_form"
  | "assigned"
  | "won"
  | "lost"
  | "note"

export type SalesDashboardActivity = {
  id: string
  href: string
  summary: string
  createdAt: string
  kind: SalesActivityKind
}

export type SalesDashboardModel = {
  title: string
  description: string
  generatedAtLabel: string
  currency: string
  monthKey: string
  monthLabel: string
  previousMonthLabel: string
  unassignedCount: number
  unassignedHref: string
  revenue: number
  revenueChange: number | null
  confirmedDeals: number
  dealsChange: number | null
  pipelineValue: number
  opportunityCount: number
  conversionRate: number | null
  newPipeline: number
  newPipelineChange: number | null
  months: SalesMonthBucket[]
  pipelineRows: SalesDashboardPipelineRow[]
  unassigned: SalesDashboardUnassigned[]
  recentActivity: SalesDashboardActivity[]
}

export function salesPipelineRowId(deal: Pick<SalesDashboardDeal, "stage" | "enquiry_stage">): SalesPipelineRowId {
  if (isEnquiryPipelineStage(deal.stage)) return enquiryCrmStageFromDeal(deal)
  return dealBoardColumnFor(canonicalDealStage(deal.stage)).id
}

export function isUnassignedNewEnquiry(deal: Pick<SalesDashboardDeal, "stage" | "enquiry_stage" | "owner_profile_id">): boolean {
  return (
    !deal.owner_profile_id &&
    isEnquiryPipelineStage(deal.stage) &&
    enquiryCrmStageFromDeal(deal) === "new"
  )
}

export function salesActivityKind(summary: string): SalesActivityKind {
  const text = summary.toLowerCase()
  if (/\b(won|paid confirmed|paid_confirmed|in fulfilment|fulfilled)\b/.test(text)) return "won"
  if (/\b(closed lost|closed_lost|not interested|lost)\b/.test(text)) return "lost"
  if (/booking form|signature|ready to send/.test(text)) return "booking_form"
  if (/email|outreach|mail sent/.test(text)) return "email"
  if (/\b(call|phone|spoke)\b/.test(text)) return "call"
  if (/price sent|proposal|quote/.test(text)) return "proposal"
  if (/assigned|owner/.test(text)) return "assigned"
  return "note"
}

function inCurrency(code: string, currency: string): boolean {
  return (code || currency).trim().toUpperCase() === currency
}

function monthSalesTotals(rows: SalesDashboardSale[], monthKey: string, currency: string) {
  const matched = rows.filter(
    (row) => inCurrency(row.currency, currency) && monthKeyUtc(confirmationStamp(row)) === monthKey,
  )
  return {
    sales: matched.reduce((sum, row) => sum + row.total, 0),
    deals: matched.length,
  }
}

function monthNewPipeline(deals: SalesDashboardDeal[], monthKey: string, currency: string): number {
  return deals
    .filter(
      (deal) =>
        dealStageIsOpenPipeline(deal.stage) &&
        inCurrency(deal.currency, currency) &&
        monthKeyUtc(deal.created_at) === monthKey,
    )
    .reduce((sum, deal) => sum + Number(deal.total_amount || 0), 0)
}

export function buildSalesDashboardView(input: {
  ownerId: string
  deals: SalesDashboardDeal[]
  sales: SalesDashboardSale[]
  now?: Date
}): SalesDashboardModel {
  const now = input.now ?? new Date()
  const monthKey = currentMonthKeyUtc(now)
  const previousMonthKey = shiftMonthKey(monthKey, -1)
  const monthKeys = lastNMonthKeys(6, monthKey)
  const ownedDeals = input.deals.filter((deal) => deal.owner_profile_id === input.ownerId)
  const ownedConfirmed = input.sales.filter(
    (row) => row.ownerId === input.ownerId && isConfirmedSale(row),
  )
  const openOwned = ownedDeals.filter((deal) => dealStageIsOpenPipeline(deal.stage))
  const currency = pickReportingCurrency(
    [
      ...ownedConfirmed.map((row) => ({ currency: row.currency, total: row.total })),
      ...openOwned.map((deal) => ({ currency: deal.currency, total: deal.total_amount })),
    ],
    "GBP",
  )
  const thisMonth = monthSalesTotals(ownedConfirmed, monthKey, currency)
  const lastMonth = monthSalesTotals(ownedConfirmed, previousMonthKey, currency)
  const newPipeline = monthNewPipeline(openOwned, monthKey, currency)
  const previousPipeline = monthNewPipeline(openOwned, previousMonthKey, currency)
  const wonCount = ownedDeals.filter((deal) => dealStageIsConfirmed(deal.stage)).length
  const lostCount = ownedDeals.filter((deal) => canonicalDealStage(deal.stage) === "closed_lost").length
  const unassigned = [...input.deals]
    .filter(isUnassignedNewEnquiry)
    .sort((a, b) => {
      const byDate = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (byDate !== 0) return byDate
      return a.reference.localeCompare(b.reference)
    })
  const pipelineCounts = new Map<SalesPipelineRowId, number>()
  for (const deal of ownedDeals) {
    const id = salesPipelineRowId(deal)
    pipelineCounts.set(id, (pipelineCounts.get(id) ?? 0) + 1)
  }
  const activitySource = [...ownedDeals, ...unassigned]
  const recentActivity = activitySource
    .flatMap((deal) =>
      deal.recent_activities.map((activity) => ({
        id: activity.id,
        href: adminRecordWorkspacePath(deal.id, deal.stage),
        summary: friendlyDealActivitySummary(activity.summary),
        createdAt: activity.created_at,
        kind: salesActivityKind(activity.summary),
      })),
    )
    .sort((a, b) => {
      const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (byDate !== 0) return byDate
      return a.id.localeCompare(b.id)
    })
    .filter((activity, index, rows) => rows.findIndex((row) => row.id === activity.id) === index)
    .slice(0, 8)

  return {
    title: SALES_DASHBOARD_TITLE,
    description: SALES_DASHBOARD_DESCRIPTION,
    generatedAtLabel: dashboardTodayLabel(now),
    currency,
    monthKey,
    monthLabel: monthLabelFromKey(monthKey),
    previousMonthLabel: monthLabelFromKey(previousMonthKey),
    unassignedCount: unassigned.length,
    unassignedHref: UNASSIGNED_ENQUIRIES_HREF,
    revenue: thisMonth.sales,
    revenueChange: percentChange(thisMonth.sales, lastMonth.sales),
    confirmedDeals: thisMonth.deals,
    dealsChange: percentChange(thisMonth.deals, lastMonth.deals),
    pipelineValue: openOwned
      .filter((deal) => inCurrency(deal.currency, currency))
      .reduce((sum, deal) => sum + Number(deal.total_amount || 0), 0),
    opportunityCount: openOwned.length,
    conversionRate: wonCount + lostCount === 0 ? null : Math.round((wonCount / (wonCount + lostCount)) * 100),
    newPipeline,
    newPipelineChange: percentChange(newPipeline, previousPipeline),
    months: monthKeys.map((key) => {
      const totals = monthSalesTotals(ownedConfirmed, key, currency)
      return {
        key,
        label: monthLabelFromKey(key),
        sales: totals.sales,
        pipeline: monthNewPipeline(openOwned, key, currency),
        deals: totals.deals,
      }
    }),
    pipelineRows: SALES_PIPELINE_ROWS.map((row) => ({
      ...row,
      count: pipelineCounts.get(row.id) ?? 0,
    })),
    unassigned: unassigned.slice(0, 5).map((deal) => ({
      id: deal.id,
      href: adminRecordWorkspacePath(deal.id, deal.stage),
      reference: deal.reference.trim() || "—",
      interest: enquiryInterestLabel(deal),
      source: dealSourceLabel(deal.source),
      receivedAt: deal.created_at,
    })),
    recentActivity,
  }
}
