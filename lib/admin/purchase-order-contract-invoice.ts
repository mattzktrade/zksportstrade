export function purchaseOrderHasContractInvoice(input: {
  contract_invoice_received: boolean | null
  documents: readonly unknown[]
}): boolean {
  if (input.contract_invoice_received != null) return input.contract_invoice_received
  return input.documents.length > 0
}

export function storedContractInvoiceReceived(
  checked: boolean,
  documentCount: number,
): boolean | null {
  return checked === documentCount > 0 ? null : checked
}
