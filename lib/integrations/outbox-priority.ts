/** Keep each drain round small enough that invoice creates cannot exhaust Xero's 60/min cap. */
export const OUTBOX_BATCH_SIZE = 20
export const INVOICE_CREATE_EVENT = "invoice.create"
export const INVOICE_CREATE_PER_BATCH = 5

export type PrioritizedOutboxRow = {
  id: string
  event_type: string
  created_at?: string
}

export function isInvoiceCreateEvent(eventType: string): boolean {
  return eventType === INVOICE_CREATE_EVENT
}

/** Invoice creates first, then the rest, oldest-first within each group. */
export function sortOutboxJobsForProcessing<T extends PrioritizedOutboxRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aInv = isInvoiceCreateEvent(a.event_type) ? 0 : 1
    const bInv = isInvoiceCreateEvent(b.event_type) ? 0 : 1
    if (aInv !== bInv) return aInv - bInv
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  })
}

/**
 * Fill a drain batch with invoice creates first (capped), then other jobs.
 * Dedupes by id so a preferred order's invoice is not processed twice.
 */
export function mergePrioritizedOutboxBatch<T extends PrioritizedOutboxRow>(input: {
  preferredInvoices?: T[]
  invoices: T[]
  others: T[]
  limit?: number
  invoiceLimit?: number
}): T[] {
  const limit = input.limit ?? OUTBOX_BATCH_SIZE
  const invoiceLimit = input.invoiceLimit ?? INVOICE_CREATE_PER_BATCH
  const seen = new Set<string>()
  const invoices: T[] = []
  const others: T[] = []

  for (const row of [...(input.preferredInvoices ?? []), ...input.invoices]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    if (invoices.length >= invoiceLimit) continue
    invoices.push(row)
  }

  for (const row of input.others) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    others.push(row)
  }

  return [...invoices, ...others].slice(0, limit)
}
