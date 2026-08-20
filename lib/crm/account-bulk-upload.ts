import { parse } from "csv-parse/sync"
import {
  ACCOUNT_KIND_OPTIONS,
  isAccountKind,
  type AccountKind,
} from "@/lib/crm/account-kinds"
import {
  ACCOUNT_SOURCES,
  type AccountSource,
} from "@/lib/crm/lead-types"

export const ACCOUNT_BULK_MAX_ROWS = 2000

export const ACCOUNT_BULK_TEMPLATE_HEADERS = [
  "Account name",
  "Contact name",
  "Email",
  "Phone",
  "Job title",
  "Account type",
  "Source",
  "Owner",
  "Notes",
  "City",
  "Country",
] as const

export const ACCOUNT_BULK_TEMPLATE_CSV = `${ACCOUNT_BULK_TEMPLATE_HEADERS.join(",")}
Apex Travel,Jane Smith,jane@apex.example,+44 20 0000 0000,Director,Travel agency,Marketing,,Met at IMEX,London,United Kingdom
Apex Travel,Sam Lee,sam@apex.example,,Sales,Travel agency,Marketing,,,,
,John Doe,john@example.com,,,,Marketing,,Campaign landing page,,
`

export type BulkUploadStaff = {
  id: string
  name: string
  email: string | null
}

export type BulkUploadDefaults = {
  source: AccountSource
  accountTypes: AccountKind[]
  ownerProfileId: string | null
  staff?: BulkUploadStaff[]
}

export type ParsedAccountBulkRow = {
  rowNumber: number
  accountName: string
  contactName: string
  email: string | null
  phone: string | null
  jobTitle: string | null
  accountTypes: AccountKind[]
  source: AccountSource
  ownerProfileId: string | null
  ownerName: string | null
  notes: string | null
  city: string | null
  country: string | null
  errors: string[]
  warnings: string[]
}

export type ParsedAccountBulkUpload = {
  headers: string[]
  rows: ParsedAccountBulkRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ACCOUNT_NAME_ALIASES = [
  "Account name",
  "Company",
  "Company name",
  "Account",
  "Organisation",
  "Organization",
]

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function cell(row: Record<string, string>, aliases: string[]): string {
  const byKey = new Map(Object.entries(row).map(([header, value]) => [key(header), value]))
  for (const alias of aliases) {
    const value = byKey.get(key(alias))
    if (value != null && value.trim() !== "") return value.trim()
  }
  return ""
}

function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseKinds(raw: string, fallback: AccountKind[]): AccountKind[] {
  if (!raw.trim()) return [...fallback]
  const parts = raw.split(/[;|,/]/g).map((part) => part.trim()).filter(Boolean)
  const unique: AccountKind[] = []
  for (const part of parts) {
    const kind = matchKind(part)
    if (!kind) continue
    if (!unique.includes(kind)) unique.push(kind)
  }
  return unique.length ? unique : [...fallback]
}

function matchKind(raw: string): AccountKind | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "_")
  if (isAccountKind(value)) return value
  const compact = raw.trim().toLowerCase()
  for (const option of ACCOUNT_KIND_OPTIONS) {
    if (option.label.toLowerCase() === compact) return option.id
    if (option.id.replaceAll("_", " ") === compact) return option.id
  }
  if (compact.includes("concierge")) return "concierge"
  if (compact.includes("travel")) return "travel_agency"
  if (compact.includes("ticket")) return "ticket_agent"
  if (compact.includes("hospitality")) return "hospitality_agency"
  if (compact.includes("direct") || compact.includes("individual") || compact.includes("person")) {
    return "direct_client"
  }
  if (compact.includes("supplier")) return "supplier"
  if (compact.includes("other")) return "other"
  return null
}

function parseSource(raw: string, fallback: AccountSource): AccountSource {
  const value = raw.trim().toLowerCase()
  if (!value) return fallback
  if ((ACCOUNT_SOURCES as readonly string[]).includes(value)) return value as AccountSource
  if (value.includes("market") || value.includes("campaign") || value.includes("event")) return "marketing"
  if (value.includes("web")) return "website"
  if (value.includes("refer")) return "referral"
  if (value.includes("manual") || value.includes("staff")) return "manual"
  return fallback
}

export function accountBulkKey(name: string): string {
  return name.trim().toLowerCase()
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function matchBulkUploadOwner(
  raw: string,
  staff: BulkUploadStaff[],
): { id: string; name: string } | { error: string } | null {
  const value = raw.trim()
  if (!value) return null
  if (UUID_RE.test(value)) {
    const hit = staff.find((member) => member.id.toLowerCase() === value.toLowerCase())
    return hit ? { id: hit.id, name: hit.name } : { error: "Owner is not a recognised staff member." }
  }
  const compact = value.toLowerCase()
  const byEmail = staff.filter((member) => (member.email ?? "").trim().toLowerCase() === compact)
  if (byEmail.length === 1) return { id: byEmail[0].id, name: byEmail[0].name }
  const byName = staff.filter((member) => member.name.trim().toLowerCase() === compact)
  if (byName.length === 1) return { id: byName[0].id, name: byName[0].name }
  if (byEmail.length > 1 || byName.length > 1) {
    return { error: "Owner matches more than one staff member." }
  }
  return { error: `Owner "${value}" is not a recognised staff member.` }
}

export function parseAccountBulkCsv(
  csvText: string,
  defaults: BulkUploadDefaults,
): ParsedAccountBulkUpload {
  const textValue = csvText.replace(/^\uFEFF/, "").trim()
  if (!textValue) {
    return { headers: [...ACCOUNT_BULK_TEMPLATE_HEADERS], rows: [], totalRows: 0, validRows: 0, errorRows: 0 }
  }

  let records: Record<string, string>[]
  try {
    records = parse(textValue, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[]
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "The CSV file could not be read.")
  }

  if (records.length > ACCOUNT_BULK_MAX_ROWS) {
    throw new Error(`Please keep the upload to ${ACCOUNT_BULK_MAX_ROWS} rows or fewer.`)
  }

  const headers = records[0] ? Object.keys(records[0]) : [...ACCOUNT_BULK_TEMPLATE_HEADERS]
  const rows: ParsedAccountBulkRow[] = records.map((record, index) => {
    const rowNumber = index + 2
    const errors: string[] = []
    const warnings: string[] = []
    const firstName = cell(record, ["First name", "First Name", "Given name"])
    const lastName = cell(record, ["Last name", "Last Name", "Surname", "Family name"])
    const contactName =
      text(cell(record, ["Contact name", "Full name", "Name", "Contact"])) ??
      text([firstName, lastName].filter(Boolean).join(" "))
    const email = text(cell(record, ["Email", "Email address", "Contact email"]))?.toLowerCase() ?? null
    const phone = text(cell(record, ["Phone", "Mobile", "Telephone", "Contact phone"]))
    const jobTitle = text(cell(record, ["Job title", "Title", "Role", "Position"]))
    const notes = text(cell(record, ["Notes", "Note", "Comments"]))
    const city = text(cell(record, ["City", "Town"]))
    const country = text(cell(record, ["Country"]))
    const namedAccount = text(cell(record, ACCOUNT_NAME_ALIASES))
    let accountName = namedAccount ?? ""
    if (!accountName && contactName) {
      accountName = contactName
      warnings.push("No company name — this row will be saved as a direct client using the contact name.")
    }
    const accountTypes = parseKinds(
      cell(record, ["Account type", "Type", "Account types", "Company type"]),
      !namedAccount && contactName ? ["direct_client"] : defaults.accountTypes,
    )
    const source = parseSource(cell(record, ["Source", "Lead source", "Origin"]), defaults.source)
    const staff = defaults.staff ?? []
    const ownerMatch = matchBulkUploadOwner(
      cell(record, ["Owner", "Account owner", "Account Owner", "Owner name", "Owner email", "Assigned to"]),
      staff,
    )
    let ownerProfileId = defaults.ownerProfileId
    let ownerName = staff.find((member) => member.id === defaults.ownerProfileId)?.name ?? null
    if (ownerMatch && "error" in ownerMatch) {
      errors.push(ownerMatch.error)
    } else if (ownerMatch) {
      ownerProfileId = ownerMatch.id
      ownerName = ownerMatch.name
    }

    if (!contactName) errors.push("Contact name is required.")
    if (!accountName) errors.push("Account name or contact name is required.")
    if (email && !EMAIL_RE.test(email)) errors.push("Email address is not valid.")

    return {
      rowNumber,
      accountName,
      contactName: contactName ?? "",
      email,
      phone,
      jobTitle,
      accountTypes,
      source,
      ownerProfileId,
      ownerName,
      notes,
      city,
      country,
      errors,
      warnings,
    }
  })

  return {
    headers,
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
  }
}
