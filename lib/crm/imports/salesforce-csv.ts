import { parse } from "csv-parse/sync"

export type CrmImportType = "contacts" | "opportunities"

export type ParsedImportRow = {
  rowNumber: number
  sourceExternalId: string | null
  rawData: Record<string, string>
  normalizedData: Record<string, string | number | boolean | null>
  errors: string[]
  warnings: string[]
}

export type ParsedCrmImport = {
  headers: string[]
  rows: ParsedImportRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function valueFor(row: Record<string, string>, aliases: string[]): string {
  const byKey = new Map(Object.entries(row).map(([header, value]) => [key(header), value]))
  for (const alias of aliases) {
    const value = byKey.get(key(alias))
    if (value != null && value.trim() !== "") return value.trim()
  }
  return ""
}

function text(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function numberValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const negative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[,$£€¥%\s()]/g, "")
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

function booleanValue(value: string): boolean {
  return ["true", "yes", "y", "1", "won", "closed won"].includes(value.trim().toLowerCase())
}

function isoDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function dateOnly(value: string): string | null {
  const iso = isoDate(value)
  return iso?.slice(0, 10) ?? null
}

function fullName(firstName: string, lastName: string, supplied: string): string | null {
  return text(supplied) ?? text([firstName, lastName].filter(Boolean).join(" "))
}

export function nativeStageForSalesforce(
  stageName: string,
  isWon: boolean,
  isClosed: boolean,
): string {
  const stage = stageName.trim().toLowerCase()
  if (isWon || stage.includes("closed won") || stage === "won") return "paid_confirmed"
  if ((isClosed && !isWon) || stage.includes("closed lost") || stage.includes("lost")) {
    return "closed_lost"
  }
  if (stage.includes("invoice") || stage.includes("payment")) return "awaiting_payment"
  if (stage.includes("sign")) return "awaiting_client_signature"
  if (stage.includes("booking") || stage.includes("form")) return "awaiting_client_signature"
  if (
    stage.includes("proposal") ||
    stage.includes("quote") ||
    stage.includes("price") ||
    stage.includes("negotiation")
  ) {
    return "proposal"
  }
  if (stage.includes("sourc")) return "sourcing"
  return "draft"
}

function nativeSource(raw: string): string {
  const source = raw.trim().toLowerCase()
  if (source.includes("portal")) return "portal"
  if (source.includes("web")) return "website"
  if (source.includes("referr")) return "referral"
  if (source.includes("offline") || source.includes("manual")) return "offline"
  return "offline"
}

function nativeAccountType(raw: string): string {
  const type = raw.trim().toLowerCase()
  if (type.includes("supplier")) return "supplier_related"
  if (
    type.includes("person") ||
    type.includes("individual") ||
    type.includes("private") ||
    type.includes("direct")
  ) {
    return "direct_client"
  }
  if (type.includes("other")) return "other"
  return "agent_company"
}

function normalizeContact(row: Record<string, string>, rowNumber: number): ParsedImportRow {
  const firstName = valueFor(row, ["First Name", "Contact First Name", "Contact: First Name"])
  const lastName = valueFor(row, ["Last Name", "Contact Last Name", "Contact: Last Name"])
  const contactName = fullName(
    firstName,
    lastName,
    valueFor(row, ["Full Name", "Contact Name", "Contact: Full Name", "Name"]),
  )
  const email = text(valueFor(row, ["Email", "Contact Email", "Contact: Email"]))
  const accountName = text(
    valueFor(row, [
      "Account Name",
      "Account: Account Name",
      "Contact: Account Name",
      "Company",
      "Company Name",
    ]),
  )
  const salesforceContactId = text(
    valueFor(row, [
      "Contact ID",
      "Contact Id",
      "Contact: Contact ID",
      "Salesforce Contact ID",
      "Id",
    ]),
  )
  const salesforceAccountId = text(
    valueFor(row, [
      "Account ID",
      "Account Id",
      "Account: Account ID",
      "Salesforce Account ID",
    ]),
  )
  const errors: string[] = []
  const warnings: string[] = []
  if (!contactName && !email) errors.push("Contact name or email is required.")
  if (!accountName && !salesforceAccountId) {
    errors.push("Account name or Salesforce Account ID is required.")
  }
  if (!salesforceContactId) {
    warnings.push(
      "Salesforce Contact ID is not included. The portal will generate its own ID and match repeat imports by account, then email or contact name.",
    )
  }
  if (booleanValue(valueFor(row, ["Is Deleted", "Deleted", "Contact: Is Deleted"]))) {
    errors.push("Deleted Salesforce contact was not imported.")
  }

  return {
    rowNumber,
    sourceExternalId: salesforceContactId,
    rawData: row,
    normalizedData: {
      salesforceContactId,
      salesforceAccountId,
      accountName,
      accountType: nativeAccountType(
        valueFor(row, ["Account Type", "Account: Account Type", "Type"]),
      ),
      contactName,
      email,
      phone: text(valueFor(row, ["Phone", "Mobile", "Mobile Phone", "Contact: Phone"])),
      jobTitle: text(valueFor(row, ["Title", "Job Title", "Contact: Title"])),
      createdAt: isoDate(valueFor(row, ["Created Date", "Contact: Created Date"])),
      updatedAt: isoDate(valueFor(row, ["Last Modified Date", "Contact: Last Modified Date"])),
    },
    errors,
    warnings,
  }
}

function normalizeOpportunity(row: Record<string, string>, rowNumber: number): ParsedImportRow {
  const salesforceOpportunityId = text(
    valueFor(row, [
      "Opportunity ID",
      "Opportunity Id",
      "Salesforce Opportunity ID",
      "Opportunity: Opportunity ID",
      "Id",
    ]),
  )
  const salesforceLineItemId = text(
    valueFor(row, [
      "Opportunity Product ID",
      "Opportunity Line Item ID",
      "Line Item ID",
      "Opportunity Product: Opportunity Product ID",
    ]),
  )
  const stageName = valueFor(row, ["Stage", "Stage Name", "Opportunity: Stage"])
  const isWon =
    booleanValue(valueFor(row, ["Is Won", "Won", "Opportunity: Is Won"])) ||
    stageName.toLowerCase().includes("closed won")
  const isClosed =
    booleanValue(valueFor(row, ["Is Closed", "Closed", "Opportunity: Is Closed"])) ||
    stageName.toLowerCase().includes("closed")
  const accountName = text(
    valueFor(row, ["Account Name", "Account: Account Name", "Opportunity: Account Name"]),
  )
  const contactFirst = valueFor(row, ["Contact First Name", "Primary Contact First Name"])
  const contactLast = valueFor(row, ["Contact Last Name", "Primary Contact Last Name"])
  const contactName = fullName(
    contactFirst,
    contactLast,
    valueFor(row, ["Primary Contact", "Contact Name", "Contact: Full Name"]),
  )
  const amount = numberValue(
    valueFor(row, ["Amount", "Opportunity Amount", "Opportunity: Amount", "Total Amount"]),
  )
  const quantity = numberValue(
    valueFor(row, ["Quantity", "Opportunity Product: Quantity", "Product Quantity"]),
  )
  const unitPrice = numberValue(
    valueFor(row, [
      "Sales Price",
      "Unit Price",
      "Opportunity Product: Sales Price",
      "List Price",
    ]),
  )
  const errors: string[] = []
  const warnings: string[] = []
  if (!salesforceOpportunityId) errors.push("Salesforce Opportunity ID is required.")
  if (!accountName && !valueFor(row, ["Account ID", "Salesforce Account ID"])) {
    errors.push("Account name or Salesforce Account ID is required.")
  }
  if (!stageName) warnings.push("Stage is blank; this opportunity will import as Enquiry.")
  if (!salesforceLineItemId && valueFor(row, ["Product ID", "Product2 ID"])) {
    warnings.push("No Opportunity Product ID; product ID will be used for line deduplication.")
  }
  if (isWon) {
    warnings.push("Won sale will be marked for stock reconciliation; stock will not be changed.")
  }
  if (booleanValue(valueFor(row, ["Is Deleted", "Deleted", "Opportunity: Is Deleted"]))) {
    errors.push("Deleted Salesforce opportunity was not imported.")
  }

  return {
    rowNumber,
    sourceExternalId: salesforceLineItemId
      ? `${salesforceOpportunityId ?? "missing"}:${salesforceLineItemId}`
      : salesforceOpportunityId,
    rawData: row,
    normalizedData: {
      salesforceOpportunityId,
      opportunityName: text(
        valueFor(row, ["Opportunity Name", "Opportunity: Opportunity Name", "Name"]),
      ),
      salesforceAccountId: text(
        valueFor(row, ["Account ID", "Account Id", "Salesforce Account ID"]),
      ),
      accountName,
      accountType: nativeAccountType(
        valueFor(row, ["Account Type", "Account: Account Type"]),
      ),
      salesforceContactId: text(
        valueFor(row, ["Contact ID", "Primary Contact ID", "Salesforce Contact ID"]),
      ),
      contactName,
      email: text(valueFor(row, ["Contact Email", "Primary Contact Email", "Email"])),
      phone: text(valueFor(row, ["Contact Phone", "Primary Contact Phone", "Phone"])),
      ownerName: text(valueFor(row, ["Opportunity Owner", "Owner Name", "Owner: Full Name"])),
      ownerEmail: text(valueFor(row, ["Owner Email", "Opportunity Owner Email"])),
      stageName: text(stageName),
      nativeStage: nativeStageForSalesforce(stageName, isWon, isClosed),
      isWon,
      isClosed,
      source: nativeSource(valueFor(row, ["Lead Source", "Source", "Channel"])),
      amount,
      currency: text(valueFor(row, ["Currency", "Currency ISO Code"])) ?? "USD",
      closeDate: dateOnly(valueFor(row, ["Close Date", "Opportunity: Close Date"])),
      lossReason: text(valueFor(row, ["Loss Reason", "Closed Lost Reason"])),
      description: text(valueFor(row, ["Description", "Opportunity: Description"])),
      createdAt: isoDate(valueFor(row, ["Created Date", "Opportunity: Created Date"])),
      updatedAt: isoDate(
        valueFor(row, ["Last Modified Date", "Opportunity: Last Modified Date"]),
      ),
      salesforceLineItemId,
      salesforceProductId: text(
        valueFor(row, [
          "Product ID",
          "Product2 ID",
          "Salesforce Product ID",
          "Product: Product ID",
        ]),
      ),
      productCode: text(
        valueFor(row, ["Product Code", "Product: Product Code", "SKU"]),
      ),
      packageId: text(valueFor(row, ["Package ID", "Portal Package ID"])),
      productName: text(
        valueFor(row, ["Product Name", "Opportunity Product", "Product: Product Name"]),
      ),
      quantity: quantity == null ? 1 : Math.max(1, Math.floor(quantity)),
      unitPrice,
      supplierName: text(
        valueFor(row, [
          "Supplier",
          "Supplier Name",
          "Opportunity Product: Supplier",
          "Supplier__c",
        ]),
      ),
      expectedUnitCost: numberValue(
        valueFor(row, [
          "Buy Price",
          "BuyPrice",
          "Expected Unit Cost",
          "Opportunity Product: Buy Price",
          "Buy_Price__c",
        ]),
      ),
    },
    errors,
    warnings,
  }
}

export function parseSalesforceCsv(
  csv: string,
  importType: CrmImportType,
  maxRows = 50_000,
): ParsedCrmImport {
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>
  if (records.length > maxRows) {
    throw new Error(`CSV contains ${records.length} rows; the maximum is ${maxRows}.`)
  }
  const headers = records[0] ? Object.keys(records[0]) : []
  if (headers.length === 0) throw new Error("CSV has no headers or data rows.")

  const rows = records.map((row, index) =>
    importType === "contacts"
      ? normalizeContact(row, index + 2)
      : normalizeOpportunity(row, index + 2),
  )
  return {
    headers,
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
  }
}

