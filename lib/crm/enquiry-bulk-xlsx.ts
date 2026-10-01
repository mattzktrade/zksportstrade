import ExcelJS from "exceljs"

function excelText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ""
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isSafeInteger(value)) return String(value)
    const rounded = Math.round(value)
    if (Math.abs(value - rounded) < 1e-6 && Number.isSafeInteger(rounded)) return String(rounded)
    return String(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value).trim()
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim()
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim()
  }
  if (typeof value === "object" && "result" in value && value.result != null) {
    const result = value.result
    if (typeof result === "number" && Number.isSafeInteger(result)) return String(result)
    return String(result).trim()
  }
  return String(cell.text ?? "").trim()
}

export async function matrixFromXlsx(buffer: ArrayBuffer | Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("That Excel file has no worksheets.")

  const matrix: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    let lastColumn = 0
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      if (colNumber > lastColumn) lastColumn = colNumber
    })
    const cells: string[] = []
    for (let col = 1; col <= lastColumn; col += 1) {
      cells.push(excelText(row.getCell(col)))
    }
    if (cells.some((cell) => cell.trim())) matrix.push(cells)
  })
  if (matrix.length === 0) throw new Error("That Excel file has no rows.")
  return matrix
}
