import { adminOrderDealPath } from "@/lib/admin/deal-link"
import { adminPackagePath } from "@/lib/admin/package-link"
import { dashboardTodayLabel } from "@/lib/admin/admin-dashboard-metrics"
import { purchaseOrderAdminHref } from "@/lib/admin/purchase-order-link"
import {
  calendarTodayIso,
  isoDateOnly,
  purchaseOrderIsPaid,
  purchaseOrderPaymentKind,
} from "@/lib/admin/purchase-order-payment"
import { invoiceDisplayStatus } from "@/lib/invoices/status"
import {
  buildOperationsCalendarFeed,
  type CalendarBookingSource,
  type OperationsCalendarFeedItem,
  type OperationsCalendarStaffEntry,
} from "@/lib/operations/calendar"

export const OPERATIONS_DASHBOARD_TITLE = "Operations Dashboard"
export const OPERATIONS_DASHBOARD_DESCRIPTION =
  "Track deadlines, stock, suppliers and finance in one place."

const DAY_MS = 24 * 60 * 60 * 1000
const DUE_SOON_DAYS = 7
const LIST_LIMIT = 5

export type OperationsDashboardCalendarKind =
  | "race"
  | "guest_deadline"
  | "collection"
  | "task"
  | "supplier_deadline"
  | "supplier_payment"

export type OperationsDashboardCalendarItem = {
  id: string
  date: string
  kind: OperationsDashboardCalendarKind
  label: string
  href: string
}

export type OperationsDashboardStockItem = {
  id: string
  name: string
  current: number
  need: number
  href: string
}

export type OperationsDashboardPaymentRow = {
  id: string
  href: string
  supplier: string
  description: string
  amount: number
  currency: string
  dueDate: string | null
  status: "overdue" | "due_soon" | "due"
}

export type OperationsDashboardInvoiceRow = {
  id: string
  href: string
  client: string
  invoiceNumber: string
  amount: number
  currency: string
  daysOverdue: number
}

export type OperationsDashboardRace = {
  id: string
  href: string
  name: string
  dateRange: string
  circuit: string
  countryCode: string
  flagUrl: string | null
}

export type OperationsDashboardModel = {
  title: string
  description: string
  generatedAtLabel: string
  todayIso: string
  supplierDeadlinesDue: number
  overdueInvoiceCount: number
  negativeStock: number
  overdueSupplierPayments: number
  calendarItems: OperationsDashboardCalendarItem[]
  stockToBuy: OperationsDashboardStockItem[]
  supplierPayments: OperationsDashboardPaymentRow[]
  overdueInvoices: OperationsDashboardInvoiceRow[]
  upcomingRaces: OperationsDashboardRace[]
}

export type OperationsDashboardBookingInput = CalendarBookingSource & {
  reference?: string
  xeroInvoiceNumber?: string | null
  total?: number
  currency?: string
  amountDue?: number
  overdueSince?: string | null
}

export type OperationsDashboardPurchaseOrderInput = {
  id: string
  po_number: string
  supplier: string
  guest_details_deadline: string | null
  tickets_received_at: string | null
  payment_due_date: string | null
  paid_at: string | null
  note: string | null
  usage: {
    lines: Array<{
      packageName: string
      eventName: string
      quantityPurchased: number
      unitCost: number
      currency: string
    }>
  }
}

export type OperationsDashboardShortageInput = {
  id: string
  packageId: string
  packageName: string
  quantity: number
  eventDate: string | null
}

export type OperationsDashboardRaceInput = {
  id: string
  name: string
  shortName?: string | null
  circuit: string
  dateRange: string
  eventDate: string
  countryCode: string
}

export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7)
}

export function isoDayDiff(laterIso: string, earlierIso: string): number {
  const later = Date.parse(`${laterIso}T00:00:00.000Z`)
  const earlier = Date.parse(`${earlierIso}T00:00:00.000Z`)
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0
  return Math.round((later - earlier) / DAY_MS)
}

export function shortRaceLabel(name: string): string {
  return name
    .replace(/^\d{4}\s+/, "")
    .replace(/\s+Grand Prix\b/gi, " GP")
    .replace(/\s+/g, " ")
    .trim()
}

export function countryFlagUrl(countryCode: string | null | undefined): string | null {
  const code = (countryCode ?? "").trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(code)) return null
  return `https://flagcdn.com/w40/${code}.png`
}

export function operationsDashboardChipLabel(item: {
  kind: OperationsDashboardCalendarKind
  title?: string
  label?: string
}): string {
  if (item.kind === "supplier_deadline") return "Supplier details due"
  if (item.kind === "supplier_payment") return "Supplier payment"
  if (item.kind === "guest_deadline") return "Guest list deadline"
  if (item.kind === "collection") return "Ticket delivery"
  if (item.kind === "race") return shortRaceLabel(item.label || item.title || "Race")
  return (item.label || item.title || "Task").trim() || "Task"
}

export function operationsPaymentRowStatus(
  po: { payment_due_date?: string | null; paid_at?: string | null },
  today = calendarTodayIso(),
): OperationsDashboardPaymentRow["status"] | "paid" | "unpaid" {
  const kind = purchaseOrderPaymentKind(po, today)
  if (kind === "paid") return "paid"
  if (kind === "overdue") return "overdue"
  if (kind === "unpaid") return "unpaid"
  const due = isoDateOnly(po.payment_due_date)
  if (!due) return "unpaid"
  const days = isoDayDiff(due, today)
  if (days >= 0 && days <= DUE_SOON_DAYS) return "due_soon"
  return "due"
}

function bookingHref(row: Pick<OperationsDashboardBookingInput, "id" | "dealId">): string {
  return adminOrderDealPath(row.dealId) ?? `/admin/operations?tab=calendar&booking=${encodeURIComponent(row.id)}`
}

function calendarHref(item: OperationsCalendarFeedItem): string {
  if (item.kind === "task") return "/admin/operations?tab=calendar"
  if (item.dealId) return `/admin/operations?tab=calendar&deal=${encodeURIComponent(item.dealId)}`
  if (item.bookingIds[0]) {
    return `/admin/operations?tab=calendar&booking=${encodeURIComponent(item.bookingIds[0])}`
  }
  return "/admin/operations?tab=calendar"
}

export function purchaseOrderCalendarItems(
  orders: OperationsDashboardPurchaseOrderInput[],
): OperationsDashboardCalendarItem[] {
  const items: OperationsDashboardCalendarItem[] = []
  for (const po of orders) {
    const deadline = isoDateOnly(po.guest_details_deadline)
    if (deadline && !isoDateOnly(po.tickets_received_at)) {
      items.push({
        id: `po-deadline:${po.id}`,
        date: deadline,
        kind: "supplier_deadline",
        label: "Supplier details due",
        href: purchaseOrderAdminHref(po.id),
      })
    }
    const due = isoDateOnly(po.payment_due_date)
    if (due && !purchaseOrderIsPaid(po)) {
      items.push({
        id: `po-payment:${po.id}`,
        date: due,
        kind: "supplier_payment",
        label: "Supplier payment",
        href: purchaseOrderAdminHref(po.id),
      })
    }
  }
  return items
}

export function feedToDashboardCalendarItems(
  feed: OperationsCalendarFeedItem[],
): OperationsDashboardCalendarItem[] {
  return feed.map((item) => ({
    id: item.id,
    date: item.date,
    kind: item.kind,
    label: operationsDashboardChipLabel({
      kind: item.kind,
      title: item.kind === "race" ? item.title : undefined,
      label: item.kind === "task" ? item.title : undefined,
    }),
    href: calendarHref(item),
  }))
}

export function compactOperationsDashboardCalendar(
  items: OperationsDashboardCalendarItem[],
): OperationsDashboardCalendarItem[] {
  const seen = new Set<string>()
  const out: OperationsDashboardCalendarItem[] = []
  const ranked: Record<OperationsDashboardCalendarKind, number> = {
    supplier_deadline: 0,
    supplier_payment: 1,
    guest_deadline: 2,
    collection: 3,
    task: 4,
    race: 5,
  }
  const sorted = [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    const byKind = ranked[a.kind] - ranked[b.kind]
    if (byKind !== 0) return byKind
    return a.label.localeCompare(b.label)
  })
  for (const item of sorted) {
    const key =
      item.kind === "race" || item.kind === "task"
        ? `${item.date}:${item.kind}:${item.label}`
        : `${item.date}:${item.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function poDescription(po: OperationsDashboardPurchaseOrderInput): string {
  const line = po.usage.lines[0]
  if (line?.packageName) {
    return line.eventName && line.eventName !== "Unknown event"
      ? `${line.packageName}`
      : line.packageName
  }
  const note = po.note?.trim()
  if (note) return note.split("\n")[0]!.slice(0, 80)
  return po.po_number
}

function poAmount(po: OperationsDashboardPurchaseOrderInput): { amount: number; currency: string } {
  const currency = po.usage.lines[0]?.currency || "USD"
  const amount = po.usage.lines.reduce((sum, line) => {
    if ((line.currency || currency) !== currency) return sum
    return sum + line.quantityPurchased * line.unitCost
  }, 0)
  return { amount, currency }
}

export function buildStockToBuy(
  rows: OperationsDashboardShortageInput[],
  limit = LIST_LIMIT,
): OperationsDashboardStockItem[] {
  const byPackage = new Map<
    string,
    { name: string; need: number; eventDate: string | null; id: string }
  >()
  for (const row of rows) {
    const current = byPackage.get(row.packageId)
    const need = Math.max(0, Math.floor(row.quantity) || 0)
    if (!current) {
      byPackage.set(row.packageId, {
        id: row.packageId,
        name: row.packageName || "Package",
        need,
        eventDate: row.eventDate,
      })
      continue
    }
    current.need += need
    if (row.eventDate && (!current.eventDate || row.eventDate < current.eventDate)) {
      current.eventDate = row.eventDate
    }
  }
  return [...byPackage.values()]
    .filter((row) => row.need > 0)
    .sort((a, b) => {
      const aDate = a.eventDate ?? "9999-12-31"
      const bDate = b.eventDate ?? "9999-12-31"
      if (aDate !== bDate) return aDate.localeCompare(bDate)
      return b.need - a.need
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      name: row.name,
      current: -row.need,
      need: row.need,
      href: adminPackagePath(row.id, "inventory"),
    }))
}

export function buildSupplierPaymentRows(
  orders: OperationsDashboardPurchaseOrderInput[],
  today = calendarTodayIso(),
  limit = LIST_LIMIT,
): OperationsDashboardPaymentRow[] {
  return orders
    .map((po) => {
      const status = operationsPaymentRowStatus(po, today)
      if (status === "paid" || status === "unpaid") return null
      const dueDate = isoDateOnly(po.payment_due_date)
      const { amount, currency } = poAmount(po)
      return {
        id: po.id,
        href: purchaseOrderAdminHref(po.id),
        supplier: po.supplier || "Supplier",
        description: poDescription(po),
        amount,
        currency,
        dueDate,
        status,
      } satisfies OperationsDashboardPaymentRow
    })
    .filter((row): row is OperationsDashboardPaymentRow => Boolean(row))
    .sort((a, b) => {
      const rank = { overdue: 0, due_soon: 1, due: 2 }
      const byStatus = rank[a.status] - rank[b.status]
      if (byStatus !== 0) return byStatus
      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
    })
    .slice(0, limit)
}

function isOverdueClientInvoice(row: Pick<OperationsDashboardBookingInput, "invoiceStatus" | "overdueSince">): boolean {
  return invoiceDisplayStatus(row.invoiceStatus) === "awaiting_payment" && Boolean(isoDateOnly(row.overdueSince))
}

export function countOverdueClientInvoices(bookings: OperationsDashboardBookingInput[]): number {
  return bookings.filter(isOverdueClientInvoice).length
}

export function buildOverdueInvoiceRows(
  bookings: OperationsDashboardBookingInput[],
  today = calendarTodayIso(),
  limit = LIST_LIMIT,
): OperationsDashboardInvoiceRow[] {
  return bookings
    .flatMap((row) => {
      if (!isOverdueClientInvoice(row)) return []
      const since = isoDateOnly(row.overdueSince)
      if (!since) return []
      const daysOverdue = Math.max(1, isoDayDiff(today, since))
      const invoiceNumber = (row.xeroInvoiceNumber ?? "").trim() || row.reference || "Invoice"
      return [
        {
          id: row.id,
          href: bookingHref(row),
          client: row.accountName || "—",
          invoiceNumber,
          amount: Number(row.amountDue || row.total || 0),
          currency: row.currency || "USD",
          daysOverdue,
        } satisfies OperationsDashboardInvoiceRow,
      ]
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.client.localeCompare(b.client))
    .slice(0, limit)
}

export function buildUpcomingRaces(
  races: OperationsDashboardRaceInput[],
  today = calendarTodayIso(),
  limit = 3,
): OperationsDashboardRace[] {
  return races
    .filter((race) => {
      const date = isoDateOnly(race.eventDate)
      return Boolean(date && date >= today)
    })
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .slice(0, limit)
    .map((race) => ({
      id: race.id,
      href: `/admin/catalog/events/${encodeURIComponent(race.id)}`,
      name: race.shortName?.trim() || shortRaceLabel(race.name),
      dateRange: race.dateRange.trim() || formatRaceDate(race.eventDate),
      circuit: race.circuit.trim() || "Circuit TBC",
      countryCode: race.countryCode.trim().toUpperCase(),
      flagUrl: countryFlagUrl(race.countryCode),
    }))
}

function formatRaceDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function countSupplierDeadlinesDueThisMonth(
  orders: OperationsDashboardPurchaseOrderInput[],
  today = calendarTodayIso(),
): number {
  const month = monthKeyFromIso(today)
  return orders.filter((po) => {
    const deadline = isoDateOnly(po.guest_details_deadline)
    if (!deadline || monthKeyFromIso(deadline) !== month) return false
    return !isoDateOnly(po.tickets_received_at)
  }).length
}

export function countOverdueSupplierPayments(
  orders: OperationsDashboardPurchaseOrderInput[],
  today = calendarTodayIso(),
): number {
  return orders.filter((po) => purchaseOrderPaymentKind(po, today) === "overdue").length
}

export function buildOperationsDashboardView(input: {
  now?: Date
  todayIso?: string
  bookings: OperationsDashboardBookingInput[]
  calendarEntries?: OperationsCalendarStaffEntry[]
  purchaseOrders: OperationsDashboardPurchaseOrderInput[]
  negativeStock: OperationsDashboardShortageInput[]
  races: OperationsDashboardRaceInput[]
}): OperationsDashboardModel {
  const todayIso = input.todayIso ?? calendarTodayIso(input.now)
  const feed = buildOperationsCalendarFeed(input.bookings, input.calendarEntries ?? [])
  const calendarItems = compactOperationsDashboardCalendar([
    ...feedToDashboardCalendarItems(feed),
    ...purchaseOrderCalendarItems(input.purchaseOrders),
  ])

  return {
    title: OPERATIONS_DASHBOARD_TITLE,
    description: OPERATIONS_DASHBOARD_DESCRIPTION,
    generatedAtLabel: dashboardTodayLabel(input.now),
    todayIso,
    supplierDeadlinesDue: countSupplierDeadlinesDueThisMonth(input.purchaseOrders, todayIso),
    overdueInvoiceCount: countOverdueClientInvoices(input.bookings),
    negativeStock: input.negativeStock.length,
    overdueSupplierPayments: countOverdueSupplierPayments(input.purchaseOrders, todayIso),
    calendarItems,
    stockToBuy: buildStockToBuy(input.negativeStock),
    supplierPayments: buildSupplierPaymentRows(input.purchaseOrders, todayIso),
    overdueInvoices: buildOverdueInvoiceRows(input.bookings, todayIso),
    upcomingRaces: buildUpcomingRaces(input.races, todayIso),
  }
}
