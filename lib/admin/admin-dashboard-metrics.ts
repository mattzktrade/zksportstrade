import { adminOrderDealPath } from "@/lib/admin/deal-link"
import { isCancelledWorkflowRow } from "@/lib/admin/workflow-status"
import { dealStageIsConfirmed, dealStageIsOpenPipeline } from "@/lib/crm/deal-types"
import { invoiceDisplayStatus, isOutstandingInvoiceStatus } from "@/lib/invoices/status"
import { APP_NUMBER_LOCALE } from "@/lib/format/money"

export const ADMIN_DASHBOARD_TITLE = "Dashboard"
export const ADMIN_DASHBOARD_DESCRIPTION =
  "A simple overview of approvals, sales, operations and finance."

export type DashboardSaleRow = {
  id: string
  dealId: string | null
  reference: string
  dealReference: string | null
  accountName: string
  eventPackage: string
  total: number
  currency: string
  createdAt: string
  paidAt: string | null
  ownerName: string | null
  orderStatus: string
  invoiceStatus: string | null
  dealStage: string | null
  fulfilmentStatus: string
  overdueSince: string | null
  amountDue: number
}

export type DashboardPipelineDeal = {
  stage: string
  total_amount: number
  currency: string
}

export type MonthBucket = {
  key: string
  label: string
  revenue: number
  profit: number
  deals: number
}

export type AdminDashboardRecentDeal = {
  id: string
  href: string
  dealNumber: string
  client: string
  eventPackage: string
  value: number
  currency: string
  confirmedAt: string
}

export type AdminDashboardModel = {
  title: string
  description: string
  generatedAtLabel: string
  currency: string
  pendingUsers: number
  paddockRequests: number
  bookingFormsAwaiting: number
  bookingFormsHref: string
  negativeStock: number
  overdueInvoices: number
  outstandingInvoices: number
  outstandingValue: number
  awaitingFulfilment: number
  activeHolds: number
  pipelineValue: number
  monthKey: string
  monthLabel: string
  previousMonthLabel: string
  revenue: number
  profit: number
  confirmedDeals: number
  revenueChange: number | null
  profitChange: number | null
  dealsChange: number | null
  months: MonthBucket[]
  recentDeals: AdminDashboardRecentDeal[]
}

export function currentMonthKeyUtc(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, (month || 1) - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export function lastNMonthKeys(n: number, fromKey: string): string[] {
  const count = Math.max(1, n)
  return Array.from({ length: count }, (_, index) => shiftMonthKey(fromKey, index - (count - 1)))
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

export function monthLabelFromKey(key: string): string {
  const [year, month] = key.split("-").map(Number)
  const label = SHORT_MONTHS[((month || 1) - 1 + 12) % 12] ?? "Jan"
  return `${label} ${year}`
}

export function dashboardTodayLabel(now = new Date()): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  })
}

export function monthKeyUtc(iso: string): string {
  const raw = iso.trim()
  if (!raw) return ""
  const date = raw.includes("T") ? new Date(raw) : new Date(`${raw.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return raw.slice(0, 7)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

export function confirmationStamp(row: Pick<DashboardSaleRow, "paidAt" | "createdAt">): string {
  return row.paidAt || row.createdAt
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return current > 0 ? 100 : -100
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

export function pickReportingCurrency(
  rows: Array<{ currency: string; total: number }>,
  fallback = "GBP",
): string {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const code = (row.currency || fallback).trim().toUpperCase() || fallback
    totals.set(code, (totals.get(code) ?? 0) + Number(row.total || 0))
  }
  if (totals.size === 0) return fallback
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback
}

export function salesRepLabel(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return "—"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0] ?? "—"
  const initial = parts[0]?.[0]?.toUpperCase() ?? ""
  return `${initial}. ${parts.slice(1).join(" ")}`
}

export function dealNumberLabel(row: { dealReference?: string | null; reference?: string | null }): string {
  return row.dealReference?.trim() || row.reference?.trim() || "—"
}

export function isConfirmedSale(row: DashboardSaleRow): boolean {
  if (isCancelledWorkflowRow(row)) return false
  if (row.dealStage && dealStageIsConfirmed(row.dealStage)) return true
  if (row.orderStatus === "historical_won") return true
  if (!row.invoiceStatus) return false
  const status = invoiceDisplayStatus(row.invoiceStatus)
  return status === "paid" || status === "delivered"
}

export function isOverdueInvoice(row: DashboardSaleRow): boolean {
  return (
    !isCancelledWorkflowRow(row) &&
    invoiceDisplayStatus(row.invoiceStatus) === "awaiting_payment" &&
    Boolean(row.overdueSince)
  )
}

export function isOutstandingInvoice(row: DashboardSaleRow): boolean {
  return !isCancelledWorkflowRow(row) && isOutstandingInvoiceStatus(row.invoiceStatus)
}

export function isAwaitingFulfilment(row: DashboardSaleRow): boolean {
  return !isCancelledWorkflowRow(row) && invoiceDisplayStatus(row.invoiceStatus) === "paid"
}

export function niceChartMax(maxValue: number): number {
  if (maxValue <= 0) return 2_000_000
  const exp = Math.floor(Math.log10(maxValue))
  const mag = 10 ** exp
  const n = maxValue / mag
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * mag
}

export function chartTicks(maxValue: number, steps = 4): number[] {
  const nice = niceChartMax(maxValue)
  return Array.from({ length: steps + 1 }, (_, index) => (nice / steps) * index)
}

export function currencySymbol(currency: string): string {
  const code = (currency || "GBP").trim().toUpperCase() || "GBP"
  try {
    const part = new Intl.NumberFormat(APP_NUMBER_LOCALE, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((item) => item.type === "currency")
    return part?.value ?? code
  } catch {
    return code
  }
}

export function formatCompactAxis(value: number, currency: string): string {
  const symbol = currencySymbol(currency)
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    const n = value / 1_000_000
    return `${symbol}${n.toFixed(n >= 10 || n <= -10 ? 0 : 1)}M`
  }
  if (abs >= 1_000) {
    const n = value / 1_000
    return `${symbol}${n.toFixed(n >= 10 || n <= -10 ? 0 : 1)}k`
  }
  return `${symbol}${Math.round(value)}`
}

type ProfitRow = DashboardSaleRow & { grossProfit?: number | null }

export function bucketSalesByMonth(
  rows: ProfitRow[],
  monthKeys: string[],
  currency: string,
): MonthBucket[] {
  return monthKeys.map((key) => {
    const totals = monthTotals(rows, key, currency)
    return { key, label: monthLabelFromKey(key), ...totals }
  })
}

function monthTotals(rows: ProfitRow[], monthKey: string, currency: string) {
  const matched = rows.filter(
    (row) =>
      (row.currency || "").trim().toUpperCase() === currency &&
      monthKeyUtc(confirmationStamp(row)) === monthKey,
  )
  return {
    revenue: matched.reduce((sum, row) => sum + row.total, 0),
    profit: matched.reduce((sum, row) => sum + Number(row.grossProfit ?? 0), 0),
    deals: matched.length,
  }
}

export function buildAdminDashboardView(input: {
  now?: Date
  pendingUsers: number
  paddockRequests: number
  bookingFormsHref: string
  bookingFormsAwaiting: number
  negativeStock: number
  activeHolds: number
  workflowRows: ProfitRow[]
  pipelineDeals: DashboardPipelineDeal[]
}): AdminDashboardModel {
  const now = input.now ?? new Date()
  const monthKey = currentMonthKeyUtc(now)
  const previousMonthKey = shiftMonthKey(monthKey, -1)
  const monthKeys = lastNMonthKeys(6, monthKey)
  const liveRows = input.workflowRows.filter((row) => !isCancelledWorkflowRow(row))
  const confirmed = liveRows.filter(isConfirmedSale)
  const currency = pickReportingCurrency(
    [
      ...confirmed.map((row) => ({ currency: row.currency, total: row.total })),
      ...input.pipelineDeals.map((deal) => ({ currency: deal.currency, total: deal.total_amount })),
      ...liveRows
        .filter(isOutstandingInvoice)
        .map((row) => ({ currency: row.currency, total: row.amountDue })),
    ],
    "GBP",
  )
  const thisMonth = monthTotals(confirmed, monthKey, currency)
  const lastMonth = monthTotals(confirmed, previousMonthKey, currency)
  const overdue = liveRows.filter(isOverdueInvoice)
  const outstanding = liveRows.filter(isOutstandingInvoice)
  const months = bucketSalesByMonth(confirmed, monthKeys, currency)
  const recentDeals = [...confirmed]
    .sort((a, b) => {
      const byDate = new Date(confirmationStamp(b)).getTime() - new Date(confirmationStamp(a)).getTime()
      if (byDate !== 0) return byDate
      return a.accountName.localeCompare(b.accountName)
    })
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      href: adminOrderDealPath(row.dealId) ?? "/admin/orders",
      dealNumber: dealNumberLabel(row),
      client: row.accountName || "—",
      eventPackage: row.eventPackage || "Product not mapped",
      value: row.total,
      currency: row.currency,
      confirmedAt: confirmationStamp(row),
    }))

  return {
    title: ADMIN_DASHBOARD_TITLE,
    description: ADMIN_DASHBOARD_DESCRIPTION,
    generatedAtLabel: dashboardTodayLabel(now),
    currency,
    pendingUsers: input.pendingUsers,
    paddockRequests: input.paddockRequests,
    bookingFormsAwaiting: input.bookingFormsAwaiting,
    bookingFormsHref: input.bookingFormsHref,
    negativeStock: input.negativeStock,
    overdueInvoices: overdue.length,
    outstandingInvoices: outstanding.length,
    outstandingValue: outstanding
      .filter((row) => (row.currency || "").trim().toUpperCase() === currency)
      .reduce((sum, row) => sum + Number(row.amountDue || 0), 0),
    awaitingFulfilment: liveRows.filter(isAwaitingFulfilment).length,
    activeHolds: input.activeHolds,
    pipelineValue: input.pipelineDeals
      .filter(
        (deal) =>
          dealStageIsOpenPipeline(deal.stage) &&
          (deal.currency || currency).trim().toUpperCase() === currency,
      )
      .reduce((sum, deal) => sum + Number(deal.total_amount || 0), 0),
    monthKey,
    monthLabel: monthLabelFromKey(monthKey),
    previousMonthLabel: monthLabelFromKey(previousMonthKey),
    revenue: thisMonth.revenue,
    profit: thisMonth.profit,
    confirmedDeals: thisMonth.deals,
    revenueChange: percentChange(thisMonth.revenue, lastMonth.revenue),
    profitChange: percentChange(thisMonth.profit, lastMonth.profit),
    dealsChange: percentChange(thisMonth.deals, lastMonth.deals),
    months,
    recentDeals,
  }
}
