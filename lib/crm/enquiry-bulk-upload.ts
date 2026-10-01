import { parse } from "csv-parse/sync"
import {
  normalizeMarketingPhone,
  parseMarketingLeadQuantity,
} from "@/lib/integrations/marketing-leads/parse"

export const ENQUIRY_BULK_MAX_ROWS = 500

export const ENQUIRY_BULK_TEMPLATE_CSV = `First name,Last name,Email,Phone,Tickets,When,Next step
Antros,Peralta,jperaltacamargo@gmail.com,529991109448,2 Tickets,Ready to book now,I'd like to discuss options first
Alex,Flores,alexao.fv06@gmail.com,526861910315,3-4 Tickets,Within the next few weeks,"Yes, that works for me"
`

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIMING_RE = /ready to book|next few weeks|just exploring|exploring for now/i
const NEXT_STEP_RE = /discuss options|works for me/i

export type EnquiryBulkAnswer = {
  question: string
  answer: string
}

export type EnquiryBulkStatus = "ready" | "error" | "duplicate"

export type ParsedEnquiryBulkRow = {
  rowNumber: number
  fullName: string
  email: string | null
  phone: string | null
  quantity: number | null
  ticketText: string | null
  answers: EnquiryBulkAnswer[]
  notes: string
  status: EnquiryBulkStatus
  message: string | null
}

export type ParsedEnquiryBulkUpload = {
  rows: ParsedEnquiryBulkRow[]
  totalRows: number
  readyRows: number
  duplicateRows: number
  errorRows: number
}

type ColumnRole = "first" | "last" | "full" | "email" | "phone" | "tickets" | "note" | "ignore"

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function headerRole(header: string): Exclude<ColumnRole, "note" | "ignore"> | null {
  const compact = key(header)
  if (!compact) return null
  if (["firstname", "givenname", "forename", "nombre"].includes(compact)) return "first"
  if (["lastname", "surname", "familyname", "apellido"].includes(compact)) return "last"
  if (["fullname", "contactname", "contact", "name", "nombrecompleto"].includes(compact)) return "full"
  if (compact === "email" || compact === "emailaddress" || compact === "correo" || compact.includes("email")) {
    return "email"
  }
  if (
    ["phone", "phonenumber", "mobile", "telephone", "tel", "whatsapp", "celular", "telefono"].includes(compact) ||
    compact.includes("phone") ||
    compact.includes("mobile") ||
    compact.includes("whatsapp")
  ) {
    return "phone"
  }
  if (
    ["tickets", "ticket", "quantity", "qty", "boletos", "entradas", "guests"].includes(compact) ||
    compact.includes("ticket") ||
    compact.includes("howmany") ||
    compact.includes("numberofticket")
  ) {
    return "tickets"
  }
  return null
}

function isIgnoredHeader(header: string): boolean {
  const compact = key(header)
  return [
    "id",
    "leadid",
    "leadgenid",
    "createdtime",
    "createdat",
    "timestamp",
    "adid",
    "adname",
    "adsetid",
    "adsetname",
    "campaignid",
    "campaignname",
    "formid",
    "platform",
    "isorganic",
  ].includes(compact)
}

function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase())
}

function isPhone(value: string): boolean {
  if (value.includes("@")) return false
  const digits = value.replace(/\D/g, "")
  return digits.length >= 8 && digits.length <= 15
}

function isTicket(value: string): boolean {
  return parseMarketingLeadQuantity(value) != null && /ticket|guest|boleto|entrada|\d/i.test(value)
}

function isPersonName(value: string): boolean {
  const text = value.trim()
  if (!text || text.length > 60) return false
  if (TIMING_RE.test(text) || NEXT_STEP_RE.test(text)) return false
  if (/[@\d]/.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 1 || words.length > 3) return false
  return words.every((word) => /^[\p{L}'’.-]+$/u.test(word))
}

function ratio(values: string[], test: (value: string) => boolean): number {
  if (values.length === 0) return 0
  return values.filter(test).length / values.length
}

function looksLikeHeader(cells: string[]): boolean {
  const filled = cells.map((cell) => cell.trim()).filter(Boolean)
  if (filled.length === 0) return false
  if (filled.some((cell) => isEmail(cell))) return false
  if (filled.some((cell) => isPhone(cell) && cell.replace(/\D/g, "").length >= 10)) return false
  return filled.some((cell) => headerRole(cell) != null || isIgnoredHeader(cell))
}

function columnValues(rows: string[][], index: number): string[] {
  return rows.map((row) => (row[index] ?? "").trim()).filter(Boolean)
}

function bestColumn(
  valuesByColumn: string[][],
  roles: ColumnRole[],
  test: (value: string) => boolean,
  threshold: number,
): number {
  let best = -1
  let bestScore = threshold
  valuesByColumn.forEach((values, index) => {
    if (roles[index] !== "note") return
    const score = ratio(values, test)
    if (score >= bestScore) {
      best = index
      bestScore = score
    }
  })
  return best
}

function noteLabel(header: string | undefined, values: string[], index: number): string {
  const title = header?.trim() ?? ""
  if (title && !/^column \d+$/i.test(title)) return title.slice(0, 160)
  if (ratio(values, (value) => TIMING_RE.test(value)) >= 0.6) return "When"
  if (ratio(values, (value) => NEXT_STEP_RE.test(value)) >= 0.6) return "Next step"
  return `Answer ${index + 1}`
}

function buildNotes(ticketText: string | null, answers: EnquiryBulkAnswer[]): string {
  const lines = ["Historical form import."]
  if (ticketText) lines.push(`Tickets: ${ticketText}`)
  for (const answer of answers) {
    if (ticketText && answer.answer === ticketText) continue
    lines.push(`${answer.question}: ${answer.answer}`)
  }
  return lines.join("\n")
}

function summarize(rows: ParsedEnquiryBulkRow[]): ParsedEnquiryBulkUpload {
  return {
    rows,
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "ready").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    errorRows: rows.filter((row) => row.status === "error").length,
  }
}

function markInFileDuplicates(rows: ParsedEnquiryBulkRow[]): ParsedEnquiryBulkRow[] {
  const seenEmail = new Set<string>()
  const seenPhone = new Set<string>()
  return rows.map((row) => {
    if (row.status !== "ready") return row
    if (row.email && seenEmail.has(row.email)) {
      return { ...row, status: "duplicate", message: "Same email appears earlier in this file." }
    }
    const digits = normalizeMarketingPhone(row.phone)
    if (!row.email && digits.length >= 8 && seenPhone.has(digits)) {
      return { ...row, status: "duplicate", message: "Same phone number appears earlier in this file." }
    }
    if (row.email) seenEmail.add(row.email)
    if (digits.length >= 8) seenPhone.add(digits)
    return row
  })
}

export function markPackageDuplicates(
  rows: ParsedEnquiryBulkRow[],
  existing: { emails: ReadonlySet<string>; phones: ReadonlySet<string> },
): ParsedEnquiryBulkRow[] {
  return rows.map((row) => {
    if (row.status !== "ready") return row
    if (row.email && existing.emails.has(row.email)) {
      return {
        ...row,
        status: "duplicate",
        message: "Already has an enquiry or deal for this package.",
      }
    }
    const digits = normalizeMarketingPhone(row.phone)
    if (!row.email && digits.length >= 8 && existing.phones.has(digits)) {
      return {
        ...row,
        status: "duplicate",
        message: "Already has an enquiry or deal for this package.",
      }
    }
    return row
  })
}

export function matrixFromCsv(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, "").trim()
  if (!text) return []
  let records: unknown
  try {
    records = parse(text, {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "The CSV file could not be read.")
  }
  if (!Array.isArray(records)) return []
  return records.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : [],
  )
}

export function parseEnquiryBulkMatrix(matrix: string[][]): ParsedEnquiryBulkUpload {
  const populated = matrix
    .map((cells, index) => ({
      rowNumber: index + 1,
      cells: cells.map((cell) => String(cell ?? "").trim()),
    }))
    .filter((row) => row.cells.some(Boolean))

  if (populated.length === 0) return summarize([])

  const headerAt = populated.findIndex((row) => looksLikeHeader(row.cells))
  const header = headerAt >= 0 ? populated[headerAt].cells : null
  const data = headerAt >= 0 ? populated.slice(headerAt + 1) : populated
  if (data.length > ENQUIRY_BULK_MAX_ROWS) {
    throw new Error(`Please keep the upload to ${ENQUIRY_BULK_MAX_ROWS} rows or fewer.`)
  }

  const width = Math.max(header?.length ?? 0, ...data.map((row) => row.cells.length), 0)
  const roles: ColumnRole[] = Array.from({ length: width }, () => "note")
  if (header) {
    const used = new Set<string>()
    header.forEach((title, index) => {
      if (isIgnoredHeader(title)) {
        roles[index] = "ignore"
        return
      }
      const role = headerRole(title)
      if (!role || used.has(role)) return
      roles[index] = role
      used.add(role)
    })
    if (roles.includes("first") || roles.includes("last")) {
      for (let index = 0; index < roles.length; index += 1) {
        if (roles[index] === "full") roles[index] = "note"
      }
    }
  }

  const dataCells = data.map((row) => row.cells)
  const valuesByColumn = Array.from({ length: width }, (_, index) => columnValues(dataCells, index))
  if (!roles.includes("email")) {
    const index = bestColumn(valuesByColumn, roles, isEmail, 0.4)
    if (index >= 0) roles[index] = "email"
  }
  if (!roles.includes("phone")) {
    const index = bestColumn(valuesByColumn, roles, isPhone, 0.4)
    if (index >= 0) roles[index] = "phone"
  }
  if (!roles.includes("tickets")) {
    const index = bestColumn(valuesByColumn, roles, isTicket, 0.4)
    if (index >= 0) roles[index] = "tickets"
  }
  if (!roles.includes("first") && !roles.includes("last") && !roles.includes("full")) {
    const nameColumns = valuesByColumn
      .map((values, index) => ({ index, score: roles[index] === "note" ? ratio(values, isPersonName) : 0 }))
      .filter((column) => column.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .sort((a, b) => a.index - b.index)
    if (nameColumns.length === 1) roles[nameColumns[0].index] = "full"
    if (nameColumns.length >= 2) {
      roles[nameColumns[0].index] = "first"
      roles[nameColumns[1].index] = "last"
    }
  }

  const labels = roles.map((role, index) =>
    role === "note" ? noteLabel(header?.[index], valuesByColumn[index] ?? [], index) : "",
  )

  function cell(cells: string[], role: ColumnRole): string {
    const index = roles.indexOf(role)
    if (index < 0) return ""
    return (cells[index] ?? "").trim()
  }

  const parsed = data.map((row) => {
    const first = cell(row.cells, "first")
    const last = cell(row.cells, "last")
    const fullName = [first, last].filter(Boolean).join(" ").trim() || cell(row.cells, "full")
    const emailRaw = cell(row.cells, "email").toLowerCase()
    const email = emailRaw || null
    const phone = cell(row.cells, "phone") || null
    const ticketText = cell(row.cells, "tickets") || null
    const quantity = parseMarketingLeadQuantity(ticketText)
    const answers = labels.flatMap((question, index) => {
      if (!question) return []
      const answer = (row.cells[index] ?? "").trim()
      if (!answer) return []
      return [{ question, answer }]
    })
    const errors: string[] = []
    if (!fullName) errors.push("Name is missing.")
    if (!email && !phone) errors.push("Email or phone is required.")
    if (email && !isEmail(email)) errors.push("Email is not valid.")
    if (!ticketText || quantity == null) errors.push("Ticket quantity is missing.")
    return {
      rowNumber: row.rowNumber,
      fullName,
      email: email && isEmail(email) ? email : email,
      phone,
      quantity,
      ticketText,
      answers,
      notes: buildNotes(ticketText, answers),
      status: errors.length ? "error" : "ready",
      message: errors.length ? errors.join(" ") : null,
    } satisfies ParsedEnquiryBulkRow
  })

  return summarize(markInFileDuplicates(parsed))
}

export function parseEnquiryBulkCsv(csvText: string): ParsedEnquiryBulkUpload {
  return parseEnquiryBulkMatrix(matrixFromCsv(csvText))
}
