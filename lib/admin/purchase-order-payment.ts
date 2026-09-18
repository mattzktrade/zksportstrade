const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

export type PurchaseOrderPaymentKind = "paid" | "overdue" | "due" | "unpaid"

export const PURCHASE_ORDER_PAYMENT_FILTERS = ["unpaid", "overdue", "paid"] as const
export type PurchaseOrderPaymentFilter = (typeof PURCHASE_ORDER_PAYMENT_FILTERS)[number]

export function isPurchaseOrderPaymentFilter(
  value: string | null | undefined,
): value is PurchaseOrderPaymentFilter {
  return typeof value === "string" && (PURCHASE_ORDER_PAYMENT_FILTERS as readonly string[]).includes(value)
}

export type PurchaseOrderPaymentFields = {
  payment_due_date?: string | null
  paid_at?: string | null
}

/** Local calendar date (YYYY-MM-DD) so overdue follows the staff member's day. */
export function calendarTodayIso(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function isoDateOnly(value: string | null | undefined): string | null {
  const iso = String(value ?? "").trim().slice(0, 10)
  return ISO_DATE_RE.test(iso) ? iso : null
}

export function purchaseOrderIsPaid(po: PurchaseOrderPaymentFields): boolean {
  return Boolean(isoDateOnly(po.paid_at))
}

export function purchaseOrderIsOverdue(
  po: PurchaseOrderPaymentFields,
  today = calendarTodayIso(),
): boolean {
  return purchaseOrderPaymentKind(po, today) === "overdue"
}

export function purchaseOrderPaymentKind(
  po: PurchaseOrderPaymentFields,
  today = calendarTodayIso(),
): PurchaseOrderPaymentKind {
  if (purchaseOrderIsPaid(po)) return "paid"
  const due = isoDateOnly(po.payment_due_date)
  if (!due) return "unpaid"
  if (due < today) return "overdue"
  return "due"
}

export function purchaseOrderDaysOverdue(
  po: PurchaseOrderPaymentFields,
  today = calendarTodayIso(),
): number {
  if (purchaseOrderPaymentKind(po, today) !== "overdue") return 0
  const due = isoDateOnly(po.payment_due_date)
  if (!due) return 0
  const dueTime = Date.parse(`${due}T00:00:00.000Z`)
  const todayTime = Date.parse(`${today}T00:00:00.000Z`)
  if (!Number.isFinite(dueTime) || !Number.isFinite(todayTime)) return 0
  return Math.max(0, Math.round((todayTime - dueTime) / DAY_MS))
}

export function purchaseOrderPaymentTone(
  kind: PurchaseOrderPaymentKind,
): "green" | "red" | "amber" | "gray" {
  if (kind === "paid") return "green"
  if (kind === "overdue") return "red"
  if (kind === "due") return "amber"
  return "gray"
}

export function purchaseOrderPaymentLabel(
  po: PurchaseOrderPaymentFields,
  formatDate: (iso: string | null) => string,
  today = calendarTodayIso(),
): string {
  const kind = purchaseOrderPaymentKind(po, today)
  if (kind === "paid") return "Paid"
  if (kind === "overdue") {
    const days = purchaseOrderDaysOverdue(po, today)
    if (days <= 0) return "Overdue"
    return days === 1 ? "Overdue 1 day" : `Overdue ${days} days`
  }
  if (kind === "due") return `Due ${formatDate(isoDateOnly(po.payment_due_date))}`
  return "Unpaid"
}
