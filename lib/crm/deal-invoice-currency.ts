import { formatMoney } from "@/lib/format/money"

/** Official UAE Central Bank peg. Locked on each AED deal. */
export const AED_PER_USD = 3.6725

export const DEAL_INVOICE_CURRENCIES = ["USD", "AED"] as const
export type DealInvoiceCurrency = (typeof DEAL_INVOICE_CURRENCIES)[number]

export type DealInvoiceReportingLine = {
  dealLineItemId?: string
  packageId: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type DealInvoiceReporting = {
  currency: "USD"
  fxRate: number
  total: number
  lines: DealInvoiceReportingLine[]
}

export function isDealInvoiceCurrency(value: string | null | undefined): value is DealInvoiceCurrency {
  const code = (value ?? "").trim().toUpperCase()
  return code === "USD" || code === "AED"
}

export function parseDealInvoiceCurrency(value: string | null | undefined): DealInvoiceCurrency {
  return (value ?? "USD").trim().toUpperCase() === "AED" ? "AED" : "USD"
}

export function assertBookingFormInvoiceCurrency(value: string | null | undefined): DealInvoiceCurrency {
  const code = (value ?? "USD").trim().toUpperCase()
  if (code === "USD" || code === "AED") return code
  throw new Error("ZK booking forms must be issued in USD or AED.")
}

export function invoiceFxRateFor(currency: DealInvoiceCurrency): number {
  return currency === "AED" ? AED_PER_USD : 1
}

export function roundDealMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function usdFromInvoiceAmount(
  amount: number,
  currency: DealInvoiceCurrency,
  fxRate = invoiceFxRateFor(currency),
): number {
  const safe = Number.isFinite(amount) ? amount : 0
  if (currency === "USD" || !fxRate || fxRate <= 0) return roundDealMoney(safe)
  return roundDealMoney(safe / fxRate)
}

export function invoiceFromUsdAmount(
  usdAmount: number,
  currency: DealInvoiceCurrency,
  fxRate = invoiceFxRateFor(currency),
): number {
  const safe = Number.isFinite(usdAmount) ? usdAmount : 0
  if (currency === "USD" || !fxRate || fxRate <= 0) return roundDealMoney(safe)
  return roundDealMoney(safe * fxRate)
}

export function convertInvoiceSalePrice(
  amount: number,
  from: DealInvoiceCurrency,
  to: DealInvoiceCurrency,
): number {
  if (from === to) return roundDealMoney(amount)
  return invoiceFromUsdAmount(usdFromInvoiceAmount(amount, from), to)
}

export function catalogPriceInInvoiceCurrency(
  usdPrice: number | null | undefined,
  currency: DealInvoiceCurrency,
): number {
  return invoiceFromUsdAmount(Number(usdPrice ?? 0), currency)
}

export function dealLineEditorSalePrice(
  line: { unit_sale_price: number; invoice_unit_sale_price?: number | null },
  currency: DealInvoiceCurrency,
): number {
  if (currency === "AED") {
    const invoicePrice = line.invoice_unit_sale_price
    if (invoicePrice != null && Number.isFinite(Number(invoicePrice))) {
      return Number(invoicePrice)
    }
    return invoiceFromUsdAmount(Number(line.unit_sale_price), "AED")
  }
  return Number(line.unit_sale_price)
}

export function invoiceTotalFromLines(
  lines: Array<{ quantity: number; invoiceUnitPrice: number }>,
): number {
  return roundDealMoney(
    lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.invoiceUnitPrice), 0),
  )
}

export function buildDealInvoiceReporting(input: {
  invoiceCurrency: DealInvoiceCurrency
  fxRate?: number
  lines: Array<{
    dealLineItemId?: string
    packageId: string
    quantity: number
    invoiceUnitPrice: number
  }>
}): DealInvoiceReporting {
  const fxRate = input.fxRate && input.fxRate > 0 ? input.fxRate : invoiceFxRateFor(input.invoiceCurrency)
  const lines = input.lines.map((line) => {
    const unitPrice = usdFromInvoiceAmount(line.invoiceUnitPrice, input.invoiceCurrency, fxRate)
    return {
      dealLineItemId: line.dealLineItemId,
      packageId: line.packageId,
      quantity: line.quantity,
      unitPrice,
      lineTotal: roundDealMoney(unitPrice * line.quantity),
    }
  })
  return {
    currency: "USD",
    fxRate,
    total: roundDealMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
    lines,
  }
}

export function dealInvoiceCrmNote(deal: {
  invoice_currency?: string | null
  invoice_total_amount?: number | null
  invoice_fx_rate?: number | null
  total_amount: number
  currency?: string | null
}): string | null {
  if (parseDealInvoiceCurrency(deal.invoice_currency) !== "AED") return null
  const invoiceTotal = Number(deal.invoice_total_amount ?? 0)
  const usdTotal = Number(deal.total_amount ?? 0)
  const rate = Number(deal.invoice_fx_rate ?? AED_PER_USD)
  return `Invoiced in ${formatMoney("AED", invoiceTotal)}. CRM value is ${formatMoney("USD", usdTotal)} at ${rate}. This was not a USD invoice.`
}

export function convertInvoiceAmountToUsd(
  amount: number,
  invoiceCurrency?: string | null,
  fxRate?: number | null,
): number {
  const currency = parseDealInvoiceCurrency(invoiceCurrency)
  const rate = fxRate && Number(fxRate) > 0 ? Number(fxRate) : invoiceFxRateFor(currency)
  return usdFromInvoiceAmount(Number(amount ?? 0), currency, rate)
}

export function bookingBankDetailsForInvoiceCurrency<T extends { currency: string }>(
  currency: string,
  banks: T[],
): T[] {
  const code = (currency || "USD").trim().toUpperCase()
  const preferred = banks.filter((bank) => bank.currency.trim().toUpperCase() === code)
  const rest = banks.filter((bank) => bank.currency.trim().toUpperCase() !== code)
  return [...preferred, ...rest]
}

export function bookingFormSnapshotInvoiceLines(snapshot: unknown): Array<{
  package_id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
  currency: string
  sort_order: number
}> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null
  const record = snapshot as {
    currency?: unknown
    lines?: unknown
  }
  if (!Array.isArray(record.lines) || record.lines.length === 0) return null
  const currency = String(record.currency || "USD")
  return record.lines.map((line, index) => {
    const row = line && typeof line === "object" && !Array.isArray(line) ? (line as Record<string, unknown>) : {}
    const quantity = Number(row.quantity ?? 0)
    const unitPrice = Number(row.unitPrice ?? 0)
    return {
      package_id: String(row.packageId ?? ""),
      description: String(row.description || row.packageName || "Package"),
      quantity,
      unit_price: unitPrice,
      line_total: Number(row.lineTotal ?? quantity * unitPrice),
      currency: String(row.currency || currency),
      sort_order: index,
    }
  })
}

export function dealInvoiceCurrencyIsLocked(deal: {
  order_id?: string | null
  stage?: string | null
}): boolean {
  if (deal.order_id) return true
  const stage = String(deal.stage ?? "")
  return (
    stage === "booking_form_sent" ||
    stage === "awaiting_client_signature" ||
    stage === "awaiting_zk_signature" ||
    stage === "form_expired" ||
    stage === "signed" ||
    stage === "awaiting_invoice" ||
    stage === "awaiting_payment" ||
    stage === "paid_confirmed" ||
    stage === "in_fulfilment" ||
    stage === "fulfilled"
  )
}

export function preparePricedInvoiceLine(
  invoiceUnitPrice: number,
  invoiceCurrency: DealInvoiceCurrency,
): { invoiceUnitPrice: number; usdUnitPrice: number } {
  const invoicePrice = roundDealMoney(invoiceUnitPrice)
  return {
    invoiceUnitPrice: invoicePrice,
    usdUnitPrice: usdFromInvoiceAmount(invoicePrice, invoiceCurrency),
  }
}

type DealInvoicePersistClient = {
  from: (table: string) => {
    select: (columns: string) => any
    update: (values: Record<string, unknown>) => any
  }
}

function missingInvoiceColumn(message: string): boolean {
  return /invoice_currency|invoice_fx_rate|invoice_total_amount|invoice_unit_sale_price|schema cache|could not find/i.test(
    message,
  )
}

export async function persistDealInvoicePricing(
  supabase: DealInvoicePersistClient,
  dealId: string,
  input: {
    invoiceCurrency: DealInvoiceCurrency
    lines: Array<{
      packageId: string
      quantity: number
      usdUnitPrice: number
      invoiceUnitPrice: number
    }>
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = new Date().toISOString()
  const invoiceTotal = invoiceTotalFromLines(input.lines)
  const { error: dealError } = await supabase
    .from("deals")
    .update({
      invoice_currency: input.invoiceCurrency,
      invoice_fx_rate: invoiceFxRateFor(input.invoiceCurrency),
      invoice_total_amount: invoiceTotal,
      updated_at: now,
    })
    .eq("id", dealId)
  if (dealError) {
    return {
      ok: false,
      message: missingInvoiceColumn(dealError.message)
        ? "Apply the latest database migration to save invoice currency."
        : dealError.message,
    }
  }

  if (input.lines.length === 0) return { ok: true }

  const { data: rows, error: lineError } = await supabase
    .from("deal_line_items")
    .select("id, package_id, quantity, unit_sale_price")
    .eq("deal_id", dealId)
    .order("sort_order")
    .order("id")
  if (lineError) {
    return {
      ok: false,
      message: missingInvoiceColumn(lineError.message)
        ? "Apply the latest database migration to save invoice currency."
        : lineError.message,
    }
  }

  const remaining = [...(rows ?? [])]
  for (const line of input.lines) {
    const exact = remaining.findIndex(
      (row) =>
        String(row.package_id) === line.packageId &&
        Number(row.quantity) === line.quantity &&
        Math.abs(Number(row.unit_sale_price) - line.usdUnitPrice) < 0.02,
    )
    const fallback = remaining.findIndex((row) => String(row.package_id) === line.packageId)
    const index = exact >= 0 ? exact : fallback
    if (index < 0) continue
    const [row] = remaining.splice(index, 1)
    const { error } = await supabase
      .from("deal_line_items")
      .update({
        invoice_unit_sale_price: line.invoiceUnitPrice,
        updated_at: now,
      })
      .eq("id", row.id)
    if (error) {
      return {
        ok: false,
        message: missingInvoiceColumn(error.message)
          ? "Apply the latest database migration to save invoice currency."
          : error.message,
      }
    }
  }

  return { ok: true }
}
