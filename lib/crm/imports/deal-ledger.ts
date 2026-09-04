import { parse } from "csv-parse/sync"
import {
  dealStageHoldsPurchasedStock,
  type DealStage,
} from "@/lib/crm/deal-types"
import { parseMoneyAmount, parseQuantity } from "@/lib/inventory/purchase-bulk-upload"

export const DEAL_LEDGER_MAX_ROWS = 5_000

export const DEAL_LEDGER_TEMPLATE_HEADERS = [
  "DATE",
  "CLIENT",
  "EVENT",
  "PRODUCT",
  "QTY",
  "SUPPLIER",
  "AMOUNT",
  "STATUS",
  "INVOICE #",
  "COMMENTS",
  "MAW Comment",
] as const

export const DEAL_LEDGER_TEMPLATE_CSV = `${DEAL_LEDGER_TEMPLATE_HEADERS.join(",")}
23.12.25,Example Travel,Australia GP,Paddock Club 3-Day,4,F1E,72000,PAID,INV-0857,,Payment recorded on Xero - receipt sent
06.01.26,Seat Unique,China GP,F1 Experiences Lounge,12,EGP,115000,UNPAID,INV-0883,1st invoice - OIL,
`

export type DealLedgerPaymentStatus = "paid" | "unpaid" | "cancelled"

export type DealLedgerStagePlan =
  | { action: "none"; warning?: string }
  | { action: "mark_paid" }
  | { action: "mark_unpaid" }
  | { action: "mark_cancelled" }
  | { action: "skip_status"; warning: string }

export type ParsedDealLedgerRow = {
  rowNumber: number
  sourceSheet: string | null
  sourceRow: number
  rawData: Record<string, string>
  client: string
  event: string
  product: string
  quantity: number | null
  amount: number | null
  supplier: string | null
  dealDate: string | null
  paymentDate: string | null
  paymentStatus: DealLedgerPaymentStatus | null
  invoiceNumber: string | null
  currency: string | null
  channel: string | null
  comments: string | null
  financeNotes: string | null
  financeNoteDate: string | null
  note: string | null
  errors: string[]
  warnings: string[]
  dealId: string | null
  dealReference: string | null
  matchScore: number | null
  matchSummary: string | null
  stagePlan: DealLedgerStagePlan | null
}

export type ParsedDealLedger = {
  headers: string[]
  rows: ParsedDealLedgerRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

type HeaderRole =
  | "client"
  | "event"
  | "product"
  | "qty"
  | "amount"
  | "supplier"
  | "status"
  | "dealDate"
  | "paymentDate"
  | "invoice"
  | "currency"
  | "channel"
  | "comments"
  | "financeNotes"
  | "financeNoteDate"
  | "ignore"

const MONTH_TITLES = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
])

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function uniqueHeaderLabel(label: string, seen: Map<string, number>): string {
  const trimmed = label.trim() || "Column"
  const count = seen.get(trimmed) ?? 0
  seen.set(trimmed, count + 1)
  return count === 0 ? trimmed : `${trimmed} ${count + 1}`
}

function classifyHeader(key: string, already: Set<HeaderRole>): HeaderRole | null {
  if (!key || key === "no" || key === "n" || key === "row") return "ignore"
  if (["grossing", "gross", "profit", "gpprofit"].includes(key)) {
    return "ignore"
  }
  if (
    key === "mawcomment" ||
    key === "mawcomments" ||
    key === "maw" ||
    key === "financenote" ||
    key === "financenotes" ||
    key === "financecomment" ||
    key === "financecomments" ||
    key.startsWith("mawcomment")
  ) {
    return already.has("financeNotes") ? "financeNoteDate" : "financeNotes"
  }
  if (["comment", "comments", "notes", "internalnotes", "dealnotes"].includes(key)) {
    return "comments"
  }
  if (["client", "account", "accountname", "company", "companyname", "customer", "clientname"].includes(key)) {
    return "client"
  }
  if (["event", "race", "gp", "grandprix", "eventname"].includes(key)) return "event"
  if (["product", "package", "productname", "packagename", "opportunityproduct"].includes(key)) {
    return "product"
  }
  if (["qty", "quantity", "units", "pax", "covers"].includes(key)) return "qty"
  if (["amount", "total", "value", "sale", "salesamount", "dealvalue"].includes(key)) return "amount"
  if (["supplier", "suppliername", "vendor"].includes(key)) return "supplier"
  if (["status", "paymentstatus", "paid", "payment"].includes(key)) return "status"
  if (
    ["invoice", "invoicenumber", "invoiceno", "invoicenum", "inv"].includes(key) ||
    key.startsWith("invoice")
  ) {
    return "invoice"
  }
  if (["xein", "currency", "ccy", "curr"].includes(key)) return "currency"
  if (["channel", "paymentmethod", "method", "paidvia"].includes(key)) return "channel"
  if (key === "date" || key === "dealdate" || key === "closedate" || key === "saledate" || key === "dateofdeal") {
    if (!already.has("dealDate")) return "dealDate"
    if (!already.has("paymentDate")) return "paymentDate"
    return "ignore"
  }
  if (["paymentdate", "datepaid", "paiddate", "paidon"].includes(key)) return "paymentDate"
  return null
}

function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map((cell) => headerKey(cell))
  const hasClient = keys.some((key) =>
    ["client", "account", "accountname", "company", "companyname", "customer", "clientname"].includes(key),
  )
  const hasEvent = keys.some((key) => ["event", "race", "gp", "grandprix", "eventname"].includes(key))
  const hasProduct = keys.some((key) =>
    ["product", "package", "productname", "packagename", "opportunityproduct"].includes(key),
  )
  return hasClient && (hasEvent || hasProduct)
}

function isTitleRow(cells: string[]): boolean {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean)
  if (filled.length === 0) return true
  if (filled.length > 2) return false
  return filled.every((value) => MONTH_TITLES.has(headerKey(value)))
}

function mapHeaders(cells: string[]): { roles: HeaderRole[]; labels: string[] } | null {
  if (!looksLikeHeader(cells)) return null
  const roles: HeaderRole[] = []
  const labels: string[] = []
  const seenLabels = new Map<string, number>()
  const assigned = new Set<HeaderRole>()
  cells.forEach((cell, index) => {
    const label = uniqueHeaderLabel(cell || `Column ${index + 1}`, seenLabels)
    labels[index] = label
    const classified = classifyHeader(headerKey(cell), assigned)
    const role = classified ?? "ignore"
    roles[index] = role
    if (role !== "ignore") assigned.add(role)
  })
  for (let index = 0; index < roles.length - 1; index += 1) {
    if (roles[index] !== "financeNotes") continue
    if (roles[index + 1] !== "ignore") continue
    roles[index + 1] = "financeNoteDate"
    assigned.add("financeNoteDate")
    break
  }
  if (!assigned.has("client")) return null
  if (!assigned.has("event") && !assigned.has("product")) return null
  return { roles, labels }
}

export function parseDealLedgerDate(value: string | Date | number | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) return excelSerialToIso(value)
    return null
  }
  const trimmed = String(value).trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)

  const dotted = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/)
  if (dotted) {
    const day = Number(dotted[1])
    const month = Number(dotted[2])
    const yearRaw = Number(dotted[3])
    const year = dotted[3].length === 2 ? (yearRaw >= 70 ? 1900 + yearRaw : 2000 + yearRaw) : yearRaw
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  }
  return null
}

function excelSerialToIso(serial: number): string {
  const utc = new Date(Date.UTC(1899, 11, 30))
  utc.setUTCDate(utc.getUTCDate() + Math.floor(serial))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`
}

export function parseDealLedgerStatus(value: string): DealLedgerPaymentStatus | null | "invalid" {
  const trimmed = value.trim()
  if (!trimmed) return null
  const compact = trimmed.toLowerCase().replace(/[^a-z]/g, "")
  if (["paid", "yes", "y", "true", "settled", "received"].includes(compact)) return "paid"
  if (["unpaid", "no", "n", "false", "outstanding", "due", "awaiting", "awaitingpayment"].includes(compact)) {
    return "unpaid"
  }
  if (["cancel", "cancelled", "canceled", "void", "voided"].includes(compact)) return "cancelled"
  return "invalid"
}

export function formatDisplayLedgerDate(iso: string | null): string | null {
  if (!iso) return null
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return iso
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function formatDealLedgerNote(input: {
  financeNotes: string | null
  financeNoteDate: string | null
  comments: string | null
  channel: string | null
  paymentDate: string | null
}): string | null {
  const lines: string[] = []
  const financeDate = formatDisplayLedgerDate(input.financeNoteDate)
  if (input.financeNotes) {
    lines.push(financeDate ? `${input.financeNotes} (${financeDate})` : input.financeNotes)
  } else if (financeDate) {
    lines.push(`Finance note ${financeDate}`)
  }
  if (input.channel) lines.push(`Paid via ${input.channel}`)
  if (input.comments && input.comments !== input.financeNotes) {
    lines.push(input.comments)
  }
  if (!input.financeNoteDate && input.paymentDate) {
    const paidOn = formatDisplayLedgerDate(input.paymentDate)
    if (paidOn && !lines.some((line) => line.includes(paidOn))) {
      lines.push(`Payment date ${paidOn}`)
    }
  }
  const note = lines.join("\n").trim()
  return note || null
}

export function mergeDealLedgerNotes(existing: string | null | undefined, incoming: string | null): string | null {
  const next = incoming?.trim() || ""
  if (!next) return existing?.trim() || null
  const current = existing?.trim() || ""
  if (!current) return next
  if (current.includes(next)) return current
  return `${current}\n\n${next}`
}

export function planDealLedgerStageUpdate(input: {
  currentStage: string
  paymentStatus: DealLedgerPaymentStatus | null
}): DealLedgerStagePlan {
  if (!input.paymentStatus) return { action: "none" }
  const stage = input.currentStage as DealStage
  const holdsStock = dealStageHoldsPurchasedStock(stage)

  if (input.paymentStatus === "paid") {
    if (["paid_confirmed", "in_fulfilment", "fulfilled"].includes(stage)) {
      return { action: "none" }
    }
    if (["signed", "awaiting_invoice", "awaiting_payment"].includes(stage)) {
      return { action: "mark_paid" }
    }
    return {
      action: "skip_status",
      warning:
        "PAID was not applied because this deal is still in the pipeline. Marking it paid here would allocate stock — update the deal manually if it should be won.",
    }
  }

  if (input.paymentStatus === "unpaid") {
    if (stage === "paid_confirmed") return { action: "mark_unpaid" }
    if (["signed", "awaiting_invoice", "awaiting_payment"].includes(stage)) {
      return { action: "none" }
    }
    if (["in_fulfilment", "fulfilled"].includes(stage)) {
      return {
        action: "skip_status",
        warning:
          "UNPAID was not applied because this deal is already in fulfilment. Revert payment from the finance screen if that is intentional.",
      }
    }
    return { action: "none" }
  }

  if (stage === "cancelled" || stage === "closed_lost") return { action: "none" }
  if (holdsStock) {
    return {
      action: "skip_status",
      warning:
        "CANCEL was not applied because this deal currently holds stock. Cancel it from the deal screen so inventory is reviewed.",
    }
  }
  return { action: "mark_cancelled" }
}

function valueAt(cells: string[], roles: HeaderRole[], role: HeaderRole): string {
  const index = roles.indexOf(role)
  if (index < 0) return ""
  return (cells[index] ?? "").trim()
}

function rawRecord(cells: string[], labels: string[]): Record<string, string> {
  const record: Record<string, string> = {}
  labels.forEach((label, index) => {
    if (!label) return
    record[label] = (cells[index] ?? "").trim()
  })
  return record
}

export type DealLedgerSourceRow = {
  sheet?: string | null
  sourceRow: number
  cells: string[]
  struck?: boolean
}

export function parseDealLedgerRows(
  sourceRows: DealLedgerSourceRow[],
  maxRows = DEAL_LEDGER_MAX_ROWS,
): ParsedDealLedger {
  const rows: ParsedDealLedgerRow[] = []
  const headers: string[] = []
  let roles: HeaderRole[] | null = null
  let labels: string[] = []

  for (const source of sourceRows) {
    const cells = source.cells.map((cell) => String(cell ?? "").trim())
    const mapped = mapHeaders(cells)
    if (mapped) {
      roles = mapped.roles
      labels = mapped.labels
      if (headers.length === 0) headers.push(...labels.filter(Boolean))
      continue
    }
    if (!roles) continue
    if (isTitleRow(cells)) continue

    const client = valueAt(cells, roles, "client")
    const event = valueAt(cells, roles, "event")
    const product = valueAt(cells, roles, "product")
    const invoiceNumber = valueAt(cells, roles, "invoice") || null
    const supplier = valueAt(cells, roles, "supplier") || null
    const currency = valueAt(cells, roles, "currency") || null
    const channel = valueAt(cells, roles, "channel") || null
    const statusRaw = valueAt(cells, roles, "status")
    const quantity = parseQuantity(valueAt(cells, roles, "qty"))
    const amount = parseMoneyAmount(valueAt(cells, roles, "amount"))
    const dealDate = parseDealLedgerDate(valueAt(cells, roles, "dealDate"))
    const paymentDate = parseDealLedgerDate(valueAt(cells, roles, "paymentDate"))
    const comments = valueAt(cells, roles, "comments") || null
    const financeNotes = valueAt(cells, roles, "financeNotes") || null
    const financeNoteDateRaw = valueAt(cells, roles, "financeNoteDate")
    const financeNoteDate = parseDealLedgerDate(financeNoteDateRaw)
    const parsedStatus = parseDealLedgerStatus(statusRaw)
    const paymentStatus = parsedStatus === "invalid" ? null : parsedStatus
    const note = formatDealLedgerNote({
      financeNotes,
      financeNoteDate,
      comments,
      channel,
      paymentDate,
    })

    if (!client && !event && !product && !invoiceNumber && amount == null && !note) continue

    const errors: string[] = []
    const warnings: string[] = []
    if (!client) errors.push("Client is required to find the deal.")
    if (!event && !product) errors.push("Event or product is required to find the deal.")
    if (!dealDate && !paymentStatus && !invoiceNumber && !note) {
      errors.push("Add a deal date, payment status, invoice number or finance note to update.")
    }
    if (valueAt(cells, roles, "dealDate") && !dealDate) {
      warnings.push(`Deal date "${valueAt(cells, roles, "dealDate")}" could not be parsed.`)
    }
    if (parsedStatus === "invalid") {
      errors.push(`Status "${statusRaw}" was not recognised. Use PAID, UNPAID or CANCEL.`)
    }
    if (source.struck && paymentStatus !== "cancelled") {
      warnings.push("Row is struck through in Excel; status still follows the STATUS column.")
    }

    rows.push({
      rowNumber: rows.length + 2,
      sourceSheet: source.sheet ?? null,
      sourceRow: source.sourceRow,
      rawData: rawRecord(cells, labels),
      client,
      event,
      product,
      quantity,
      amount,
      supplier,
      dealDate,
      paymentDate,
      paymentStatus,
      invoiceNumber: invoiceNumber ? invoiceNumber.replace(/\s+/g, " ").trim() : null,
      currency,
      channel,
      comments,
      financeNotes,
      financeNoteDate,
      note,
      errors,
      warnings,
      dealId: null,
      dealReference: null,
      matchScore: null,
      matchSummary: null,
      stagePlan: null,
    })
  }

  if (rows.length === 0) {
    throw new Error(
      "No sales-ledger rows were found. Use a sheet with CLIENT, EVENT, PRODUCT, STATUS and INVOICE # columns.",
    )
  }
  if (rows.length > maxRows) {
    throw new Error(`Spreadsheet contains ${rows.length} data rows; the maximum is ${maxRows}.`)
  }

  return {
    headers: headers.length ? headers : [...DEAL_LEDGER_TEMPLATE_HEADERS],
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
  }
}

function csvMatrix(text: string): string[][] {
  const options = { bom: true, relax_column_count: true, skip_empty_lines: false, trim: true as const }
  const comma = parse(text, options) as string[][]
  const commaWidth = Math.max(0, ...comma.map((row) => row.length))
  if (commaWidth >= 5) return comma
  const semi = parse(text, { ...options, delimiter: ";" }) as string[][]
  const semiWidth = Math.max(0, ...semi.map((row) => row.length))
  if (semiWidth > commaWidth) return semi
  const tab = parse(text, { ...options, delimiter: "\t" }) as string[][]
  const tabWidth = Math.max(0, ...tab.map((row) => row.length))
  return tabWidth > commaWidth ? tab : comma
}

export function parseDealLedgerCsv(csv: string, maxRows = DEAL_LEDGER_MAX_ROWS): ParsedDealLedger {
  const matrix = csvMatrix(csv)
  return parseDealLedgerRows(
    matrix.map((cells, index) => ({
      sourceRow: index + 1,
      cells: cells.map((cell) => String(cell ?? "")),
    })),
    maxRows,
  )
}

export function recountDealLedger(parsed: ParsedDealLedger): ParsedDealLedger {
  return {
    ...parsed,
    validRows: parsed.rows.filter((row) => row.errors.length === 0).length,
    errorRows: parsed.rows.filter((row) => row.errors.length > 0).length,
  }
}

export function dealLedgerNormalizedData(row: ParsedDealLedgerRow): Record<string, string | number | boolean | null> {
  return {
    sheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    client: row.client,
    event: row.event,
    product: row.product,
    quantity: row.quantity,
    amount: row.amount,
    supplier: row.supplier,
    dealDate: row.dealDate,
    paymentDate: row.paymentDate,
    paymentStatus: row.paymentStatus,
    invoiceNumber: row.invoiceNumber,
    currency: row.currency,
    channel: row.channel,
    comments: row.comments,
    financeNotes: row.financeNotes,
    financeNoteDate: row.financeNoteDate,
    note: row.note,
    dealId: row.dealId,
    dealReference: row.dealReference,
    matchScore: row.matchScore,
    matchSummary: row.matchSummary,
    stageAction: row.stagePlan?.action ?? null,
    stageWarning: row.stagePlan && "warning" in row.stagePlan ? row.stagePlan.warning ?? null : null,
  }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function dealLedgerFailuresCsv(
  rows: Array<{
    rawData: Record<string, string>
    errors: string[]
    warnings?: string[]
    applyError?: string | null
    sheet?: string | null
    sourceRow?: number | null
    matchSummary?: string | null
  }>,
  headers: string[],
): string {
  const columns = [
    ...headers.filter(Boolean),
    "Sheet",
    "Source row",
    "Failure reason",
    "Match notes",
  ]
  const lines = [columns.map(csvEscape).join(",")]
  for (const row of rows) {
    const reason = [...row.errors, row.applyError].filter(Boolean).join(" | ")
    const record = columns.map((header) => {
      if (header === "Sheet") return csvEscape(row.sheet ?? "")
      if (header === "Source row") return csvEscape(row.sourceRow == null ? "" : String(row.sourceRow))
      if (header === "Failure reason") return csvEscape(reason)
      if (header === "Match notes") return csvEscape(row.matchSummary || (row.warnings ?? []).join(" | "))
      return csvEscape(row.rawData[header] ?? "")
    })
    lines.push(record.join(","))
  }
  return `\uFEFF${lines.join("\r\n")}`
}
