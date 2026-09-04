import ExcelJS from "exceljs"
import {
  parseDealLedgerRows,
  type ParsedDealLedger,
} from "@/lib/crm/imports/deal-ledger"

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function excelSerialToIso(serial: number): string {
  const utc = new Date(Date.UTC(1899, 11, 30))
  utc.setUTCDate(utc.getUTCDate() + Math.floor(serial))
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`
}

function excelText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ""
  if (typeof value === "number") {
    const fmt = String(cell.numFmt ?? "").toLowerCase()
    if (value > 20000 && value < 80000 && (fmt.includes("d") || fmt.includes("yy") || cell.type === ExcelJS.ValueType.Date)) {
      return excelSerialToIso(value)
    }
    return String(value).trim()
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ""
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value).trim()
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim()
  }
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim()
  }
  if (typeof value === "object" && "result" in value && value.result != null) {
    if (value.result instanceof Date) {
      return `${value.result.getUTCFullYear()}-${pad(value.result.getUTCMonth() + 1)}-${pad(value.result.getUTCDate())}`
    }
    return String(value.result).trim()
  }
  return String(cell.text ?? "").trim()
}

function rowStruck(row: ExcelJS.Row): boolean {
  let struck = 0
  let filled = 0
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = excelText(cell)
    if (!text) return
    filled += 1
    if (cell.font?.strike) struck += 1
  })
  return filled > 0 && struck >= Math.ceil(filled / 2)
}

export async function parseDealLedgerXlsx(
  buffer: ArrayBuffer | Buffer,
  maxRows?: number,
): Promise<ParsedDealLedger> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as ArrayBuffer)
  const sourceRows: Array<{ sheet: string; sourceRow: number; cells: string[]; struck: boolean }> = []

  for (const sheet of workbook.worksheets) {
    if (sheet.state === "hidden" || sheet.state === "veryHidden") continue
    const columnCount = Math.max(sheet.columnCount, 1)
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = []
      for (let col = 1; col <= columnCount; col += 1) {
        cells[col - 1] = excelText(row.getCell(col))
      }
      if (!cells.some((cell) => cell)) return
      sourceRows.push({
        sheet: sheet.name,
        sourceRow: rowNumber,
        cells,
        struck: rowStruck(row),
      })
    })
  }

  if (sourceRows.length === 0) {
    throw new Error("That Excel file has no readable worksheets.")
  }
  return parseDealLedgerRows(sourceRows, maxRows)
}
