export const NEGATIVE_STOCK_OPEN_STATUSES = ["open", "quoted", "confirmed"] as const

export type NegativeStockStatus = (typeof NEGATIVE_STOCK_OPEN_STATUSES)[number]
export type NegativeStockReason = "brokered" | "historical_reconciliation"
export type NegativeStockUrgency = "critical" | "urgent" | "later" | "unknown"
export type NegativeStockSortKey = "eventDate" | "event" | "created" | "cost" | "sale" | "profit"

export type NegativeStockRow = {
  id: string
  dealId: string | null
  packageId: string
  quantity: number
  unitCost: number
  unitSale: number
  currency: string
  supplierId: string | null
  supplierName: string | null
  supplierQuoteAt: string | null
  quoteFresh: boolean
  status: NegativeStockStatus
  reason: NegativeStockReason
  createdAt: string
  note: string | null
  eventName: string
  eventDate: string | null
  location: string | null
  packageName: string
  dealReference: string | null
  accountName: string | null
  accountId: string | null
  ownerName: string | null
  ownerProfileId: string | null
}

export type NegativeStockFilters = {
  search: string
  eventNames: string[]
  supplierName: string
  reason: "" | NegativeStockReason
  urgency: "" | NegativeStockUrgency
  assignedTo: string
  status: "" | NegativeStockStatus
}

export function daysUntilEvent(eventDate: string | null | undefined, now = new Date()): number | null {
  if (!eventDate) return null
  const parsed = new Date(eventDate)
  if (Number.isNaN(parsed.getTime())) return null
  return Math.ceil((parsed.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

export function urgencyForEvent(eventDate: string | null | undefined, now = new Date()): NegativeStockUrgency {
  const days = daysUntilEvent(eventDate, now)
  if (days == null) return "unknown"
  if (days <= 7) return "critical"
  if (days <= 45) return "urgent"
  return "later"
}

export function statusLabel(status: NegativeStockStatus): string {
  if (status === "confirmed") return "Pending purchase"
  if (status === "quoted") return "Quoted"
  return "Needs quote"
}

export function reasonLabel(reason: NegativeStockReason): string {
  return reason === "historical_reconciliation" ? "Missing historical purchase" : "Brokered stock"
}

export function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function hasActiveNegativeStockFilters(filters: NegativeStockFilters): boolean {
  return Boolean(
    filters.search.trim() ||
      filters.eventNames.length > 0 ||
      filters.supplierName ||
      filters.reason ||
      filters.urgency ||
      filters.assignedTo ||
      filters.status,
  )
}

export function filterNegativeStockRows(
  rows: NegativeStockRow[],
  filters: NegativeStockFilters,
  now = new Date(),
): NegativeStockRow[] {
  const query = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.eventNames.length > 0 && !filters.eventNames.includes(row.eventName)) return false
    if (filters.supplierName && (row.supplierName ?? "Not assigned") !== filters.supplierName) return false
    if (filters.reason && row.reason !== filters.reason) return false
    if (filters.assignedTo && (row.ownerName ?? "Unassigned") !== filters.assignedTo) return false
    if (filters.status && row.status !== filters.status) return false
    if (filters.urgency && urgencyForEvent(row.eventDate, now) !== filters.urgency) return false
    if (!query) return true
    return [
      row.eventName,
      row.packageName,
      row.location,
      row.supplierName,
      row.accountName,
      row.ownerName,
      row.dealReference,
      row.dealId,
      row.note,
      statusLabel(row.status),
      reasonLabel(row.reason),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  })
}

export function sortNegativeStockRows(
  rows: NegativeStockRow[],
  sortKey: NegativeStockSortKey,
  descending: boolean,
): NegativeStockRow[] {
  const sorted = [...rows].sort((a, b) => {
    const direction = descending ? -1 : 1
    switch (sortKey) {
      case "event":
        return a.eventName.localeCompare(b.eventName) * direction
      case "created":
        return a.createdAt.localeCompare(b.createdAt) * direction
      case "cost":
        return (a.unitCost * a.quantity - b.unitCost * b.quantity) * direction
      case "sale":
        return (a.unitSale * a.quantity - b.unitSale * b.quantity) * direction
      case "profit":
        return (
          (a.unitSale * a.quantity - a.unitCost * a.quantity - (b.unitSale * b.quantity - b.unitCost * b.quantity)) *
          direction
        )
      case "eventDate":
      default: {
        const aDate = a.eventDate ?? (descending ? "" : "9999-12-31")
        const bDate = b.eventDate ?? (descending ? "" : "9999-12-31")
        return aDate.localeCompare(bDate) * direction
      }
    }
  })
  return sorted
}

export function summarizeNegativeStock(rows: NegativeStockRow[], now = new Date()) {
  return {
    count: rows.length,
    urgent: rows.filter((row) => {
      const urgency = urgencyForEvent(row.eventDate, now)
      return urgency === "critical" || urgency === "urgent"
    }).length,
    purchaseValue: rows.reduce((sum, row) => sum + row.unitCost * row.quantity, 0),
    saleValue: rows.reduce((sum, row) => sum + row.unitSale * row.quantity, 0),
  }
}
