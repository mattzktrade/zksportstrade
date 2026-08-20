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
