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
