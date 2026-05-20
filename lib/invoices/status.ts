export const INVOICE_WORKFLOW_STATUSES = ["awaiting_invoice", "awaiting_payment", "paid"] as const

export type InvoiceWorkflowStatus = (typeof INVOICE_WORKFLOW_STATUSES)[number]

const STATUS_SET = new Set<string>(INVOICE_WORKFLOW_STATUSES)

export function isInvoiceWorkflowStatus(value: string): value is InvoiceWorkflowStatus {
  return STATUS_SET.has(value)
}

/** Maps legacy DB values (pre-migration) to the current workflow model. */
export function normalizeInvoiceStatus(raw: string): InvoiceWorkflowStatus {
  if (isInvoiceWorkflowStatus(raw)) return raw
  if (raw === "pending" || raw === "overdue") return "awaiting_payment"
  return "awaiting_invoice"
}

export const invoiceWorkflowStatusLabels: Record<InvoiceWorkflowStatus, string> = {
  awaiting_invoice: "Confirmed",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
}

/** Agent-facing payment labels (no separate portal invoice number). */
export const paymentWorkflowStatusLabels = invoiceWorkflowStatusLabels

export function isOutstandingInvoiceStatus(status: string | null | undefined): boolean {
  if (status == null || status === "") return false
  const n = normalizeInvoiceStatus(status)
  return n !== "paid"
}
