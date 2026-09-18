export function isCancelledWorkflowRow(row: {
  orderStatus: string
  invoiceStatus: string | null
  dealStage: string | null
  fulfilmentStatus: string
}): boolean {
  return (
    row.orderStatus === "cancelled" ||
    row.invoiceStatus === "cancelled" ||
    row.dealStage === "cancelled" ||
    row.dealStage === "closed_lost" ||
    row.fulfilmentStatus === "cancelled"
  )
}

export const FINANCE_STATUS_FILTERS = [
  "all",
  "awaiting_booking_form",
  "ready_to_send",
  "awaiting_invoice",
  "awaiting_payment",
  "overdue",
  "paid",
] as const

export type FinanceStatusFilter = (typeof FINANCE_STATUS_FILTERS)[number]

export function isFinanceStatusFilter(value: string | null | undefined): value is FinanceStatusFilter {
  return typeof value === "string" && (FINANCE_STATUS_FILTERS as readonly string[]).includes(value)
}

export function operationsTicketStatus(row: {
  fulfilmentStatus: string
  deliveryStatus: string
}): "not_ready" | "ready" | "delivered" {
  if (
    row.fulfilmentStatus === "delivered" ||
    ["sent", "confirmed", "delivered"].includes(row.deliveryStatus)
  ) {
    return "delivered"
  }
  if (row.deliveryStatus === "ready") return "ready"
  return "not_ready"
}
