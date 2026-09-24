export const INVOICE_WORKFLOW_STATUSES = [
  "awaiting_invoice",
  "awaiting_payment",
  "paid",
  "delivered",
] as const

export type InvoiceWorkflowStatus = (typeof INVOICE_WORKFLOW_STATUSES)[number]

const STATUS_SET = new Set<string>(INVOICE_WORKFLOW_STATUSES)

export function isInvoiceWorkflowStatus(value: string): value is InvoiceWorkflowStatus {
  return STATUS_SET.has(value)
}

/** Maps legacy DB values (pre-migration) to the current workflow model. */
export function normalizeInvoiceStatus(raw: string): InvoiceWorkflowStatus {
  if (isInvoiceWorkflowStatus(raw)) return raw
  if (raw === "pending" || raw === "overdue" || raw === "awaiting_signature") return "awaiting_payment"
  return "awaiting_invoice"
}

export const invoiceWorkflowStatusLabels: Record<InvoiceWorkflowStatus, string> = {
  awaiting_invoice: "Awaiting invoice",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  delivered: "Delivered",
}

/** UI labels — invoices are created automatically; legacy awaiting_invoice shows as awaiting payment. */
export function invoiceDisplayStatus(status: string | null | undefined): InvoiceWorkflowStatus {
  const n = normalizeInvoiceStatus(status ?? "awaiting_payment")
  return n === "awaiting_invoice" ? "awaiting_payment" : n
}

export function invoiceDisplayLabel(status: string | null | undefined): string {
  return invoiceWorkflowStatusLabels[invoiceDisplayStatus(status)]
}

/** Statuses admins can pick in order dropdowns. */
export const INVOICE_UI_STATUSES = ["awaiting_payment", "paid", "delivered"] as const
export type InvoiceUiStatus = (typeof INVOICE_UI_STATUSES)[number]

/** Agent-facing payment labels (no separate portal invoice number). */
export const paymentWorkflowStatusLabels: Record<InvoiceWorkflowStatus, string> = {
  awaiting_invoice: "Awaiting payment",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  delivered: "Delivered",
}

export function isOutstandingInvoiceStatus(status: string | null | undefined): boolean {
  if (status == null || status === "") return false
  const n = normalizeInvoiceStatus(status)
  return n !== "paid" && n !== "delivered"
}

const INVOICE_STATUS_RANK: Record<InvoiceWorkflowStatus, number> = {
  delivered: 5,
  paid: 4,
  awaiting_payment: 3,
  awaiting_invoice: 2,
}

function invoiceList<T>(invoices: T | T[] | null | undefined): T[] {
  return Array.isArray(invoices) ? invoices : invoices ? [invoices] : []
}

function isCancelledInvoiceStatus(status: string | null | undefined): boolean {
  return status === "cancelled"
}

function isOpenInvoiceStatus(status: string | null | undefined): boolean {
  return !isCancelledInvoiceStatus(status) && isOutstandingInvoiceStatus(status)
}

/** Prefer delivered over paid when an order has more than one invoice row. */
export function pickPreferredInvoice<T extends { status: string }>(
  invoices: T | T[] | null | undefined,
): T | null {
  const list = invoiceList(invoices)
  return (
    [...list].sort(
      (a, b) =>
        (INVOICE_STATUS_RANK[normalizeInvoiceStatus(b.status)] ?? 1) -
        (INVOICE_STATUS_RANK[normalizeInvoiceStatus(a.status)] ?? 1),
    )[0] ?? null
  )
}

export function sortInvoicesByInstallment<
  T extends {
    installment_index?: number | null
    due_date?: string | null
    created_at?: string | null
  },
>(invoices: T | T[] | null | undefined): T[] {
  return [...invoiceList(invoices)].sort((a, b) => {
    const indexA = Number(a.installment_index ?? 0)
    const indexB = Number(b.installment_index ?? 0)
    if (indexA !== indexB) return indexA - indexB
    const due = String(a.due_date ?? "").localeCompare(String(b.due_date ?? ""))
    if (due !== 0) return due
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  })
}

/** Next unpaid installment, otherwise the last row. */
export function pickCurrentInvoice<
  T extends {
    status: string
    installment_index?: number | null
    due_date?: string | null
    created_at?: string | null
  },
>(invoices: T | T[] | null | undefined): T | null {
  const list = sortInvoicesByInstallment(invoices)
  if (!list.length) return null
  return list.find((row) => isOpenInvoiceStatus(row.status)) ?? list[list.length - 1] ?? null
}

export function aggregateInvoiceStatus(
  invoices: Array<{ status: string }> | { status: string } | null | undefined,
): InvoiceWorkflowStatus | null {
  const statuses = invoiceList(invoices)
    .filter((row) => !isCancelledInvoiceStatus(row.status))
    .map((row) => normalizeInvoiceStatus(row.status))
  if (!statuses.length) return null
  if (statuses.every((status) => status === "delivered")) return "delivered"
  if (statuses.every((status) => status === "paid" || status === "delivered")) return "paid"
  if (statuses.some((status) => status === "awaiting_payment")) return "awaiting_payment"
  return "awaiting_invoice"
}

export function allOrderInvoicesPaid(
  invoices: Array<{ status: string }> | { status: string } | null | undefined,
): boolean {
  const list = invoiceList(invoices).filter((row) => !isCancelledInvoiceStatus(row.status))
  return list.length > 0 && list.every((row) => {
    const status = normalizeInvoiceStatus(row.status)
    return status === "paid" || status === "delivered"
  })
}
