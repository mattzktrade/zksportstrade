import ExcelJS from "exceljs"
import type { PurchaseBulkCell } from "@/lib/inventory/purchase-bulk-upload"
import { extractContractLink } from "@/lib/inventory/purchase-bulk-upload"

function excelHyperlink(cell: ExcelJS.Cell): string | null {
  const direct = cell.hyperlink
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  const value = cell.value
  if (value && typeof value === "object" && "hyperlink" in value) {
    const link = (value as { hyperlink?: unknown }).hyperlink
    if (typeof link === "string" && link.trim()) return link.trim()
  }
  return null
}

function excelText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim()
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim()
  }
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim()
  }
  if (typeof value === "object" && "result" in value && value.result != null) {
    return String(value.result).trim()
  }
  return String(cell.text ?? "").trim()
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export async function recordsFromXlsx(buffer: ArrayBuffer | Buffer): Promise<Record<string, PurchaseBulkCell>[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as ArrayBuffer)
  const sheet =
    workbook.worksheets.find((item) => {
      const first = item.getRow(1)
      const headers = first.values
      const blob = Array.isArray(headers) ? headers.map((value) => String(value ?? "")).join(" ") : ""
      return /event/i.test(blob) && /package|qty|supplier/i.test(blob)
    }) ?? workbook.worksheets[0]
  if (!sheet) throw new Error("That Excel file has no worksheets.")

  let headerRowIndex = 1
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 12); rowNumber++) {
    const values = sheet.getRow(rowNumber).values
    const blob = Array.isArray(values) ? values.map((value) => String(value ?? "")).join(" ").toLowerCase() : ""
    if (blob.includes("event") && (blob.includes("package") || blob.includes("qty"))) {
      headerRowIndex = rowNumber
      break
    }
  }

  const headerRow = sheet.getRow(headerRowIndex)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = excelText(cell) || `Column ${colNumber}`
  })
  if (!headers.some((header) => headerKey(header ?? "") === "event")) {
    throw new Error("Could not find an Event column. Use the first sheet of the inventory purchase workbook.")
  }

  const records: Record<string, PurchaseBulkCell>[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return
    const record: Record<string, PurchaseBulkCell> = {}
    let empty = true
    headers.forEach((header, colNumber) => {
      if (!header || colNumber === 0) return
      const cell = row.getCell(colNumber)
      const value = excelText(cell)
      const hyperlink = excelHyperlink(cell)
      const extracted = extractContractLink(value, hyperlink)
      if (value || extracted.url || hyperlink) empty = false
      record[header] = { value, url: extracted.url }
    })
    if (!empty) records.push(record)
  })
  return records
}
