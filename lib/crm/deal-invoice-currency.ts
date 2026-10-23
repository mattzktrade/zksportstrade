import { formatMoney } from "@/lib/format/money"

/** Official UAE Central Bank peg. Locked on each AED deal. */
export const AED_PER_USD = 3.6725

export const DEAL_INVOICE_CURRENCIES = ["USD", "AED", "GBP", "EUR"] as const
export type DealInvoiceCurrency = (typeof DEAL_INVOICE_CURRENCIES)[number]
export type DealInvoiceFxRates = Record<DealInvoiceCurrency, number>

/**
 * Fallback GBP/EUR rates (invoice units per 1 USD) used when the ECB feed is
 * unavailable. Live rates replace these on save and are then locked on the deal.
 */
export const FALLBACK_GBP_PER_USD = 0.76
export const FALLBACK_EUR_PER_USD = 0.86

export const FALLBACK_INVOICE_FX_RATES: DealInvoiceFxRates = {
  USD: 1,
  AED: AED_PER_USD,
  GBP: FALLBACK_GBP_PER_USD,
  EUR: FALLBACK_EUR_PER_USD,
}

const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FX_RETRY_TTL_MS = 15 * 60 * 1000
let fxCache: { rates: DealInvoiceFxRates; fetchedAt: number; live: boolean } | null = null

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
  return (DEAL_INVOICE_CURRENCIES as readonly string[]).includes(code)
}

export function parseDealInvoiceCurrency(value: string | null | undefined): DealInvoiceCurrency {
  const code = (value ?? "USD").trim().toUpperCase()
  return isDealInvoiceCurrency(code) ? code : "USD"
}

export function isNonUsdInvoiceCurrency(
  value: string | null | undefined,
): value is Exclude<DealInvoiceCurrency, "USD"> {
  const code = parseDealInvoiceCurrency(value)
  return code !== "USD"
}

export function assertBookingFormInvoiceCurrency(value: string | null | undefined): DealInvoiceCurrency {
  const code = (value ?? "USD").trim().toUpperCase()
  if (isDealInvoiceCurrency(code)) return code
  throw new Error("ZK booking forms must be issued in USD, AED, GBP, or EUR.")
}

export function invoiceFxRateFor(
  currency: DealInvoiceCurrency,
  rates?: Partial<DealInvoiceFxRates> | null,
): number {
  const explicit = rates?.[currency]
  if (explicit && explicit > 0) return explicit
  if (currency === "AED") return AED_PER_USD
  if (fxCache?.rates[currency] && fxCache.rates[currency] > 0) return fxCache.rates[currency]
  return FALLBACK_INVOICE_FX_RATES[currency]
}

function roundFxRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

export async function loadDealInvoiceFxRates(): Promise<DealInvoiceFxRates> {
  const now = Date.now()
  if (fxCache && now - fxCache.fetchedAt < (fxCache.live ? FX_CACHE_TTL_MS : FX_RETRY_TTL_MS)) {
    return fxCache.rates
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const response = await fetch("https://api.frankfurter.app/latest?from=USD&to=GBP,EUR", {
      signal: controller.signal,
      cache: "no-store",
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`FX feed ${response.status}`)
    const body = (await response.json()) as { rates?: { GBP?: number; EUR?: number } }
    const gbp = Number(body.rates?.GBP)
    const eur = Number(body.rates?.EUR)
    if (!(gbp > 0) || !(eur > 0)) throw new Error("FX feed returned invalid GBP/EUR rates.")
    const rates: DealInvoiceFxRates = {
      USD: 1,
      AED: AED_PER_USD,
      GBP: roundFxRate(gbp),
      EUR: roundFxRate(eur),
    }
    fxCache = { rates, fetchedAt: now, live: true }
    return rates
  } catch {
    const rates = { ...FALLBACK_INVOICE_FX_RATES }
    fxCache = { rates, fetchedAt: now, live: false }
    return rates
  }
}

export async function resolveDealInvoiceFxRate(input: {
  invoiceCurrency: DealInvoiceCurrency
  storedCurrency?: DealInvoiceCurrency | null
  storedFxRate?: number | null
}): Promise<number> {
  if (input.invoiceCurrency === "USD") return 1
  if (input.invoiceCurrency === "AED") return AED_PER_USD
  if (
    input.storedCurrency === input.invoiceCurrency &&
    input.storedFxRate != null &&
    Number(input.storedFxRate) > 0
  ) {
    return Number(input.storedFxRate)
  }
  const rates = await loadDealInvoiceFxRates()
  return rates[input.invoiceCurrency]
}

export function invoiceCurrencyHelpText(
  currency: DealInvoiceCurrency,
  fxRate?: number | null,
): string | null {
  if (currency === "USD") return null
  const rate = fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(currency)
  if (currency === "AED") {
    return `Sale prices are in AED. The CRM stores the official USD conversion at ${rate} for stats.`
  }
  return `Sale prices are in ${currency}. The CRM stores the USD conversion at ${rate} ${currency} per 1 USD for stats.`
}

export function roundDealMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function usdFromInvoiceAmount(
  amount: number,
  currency: DealInvoiceCurrency,
  fxRate?: number | null,
): number {
  const safe = Number.isFinite(amount) ? amount : 0
  const rate = fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(currency)
  if (currency === "USD" || !rate) return roundDealMoney(safe)
  return roundDealMoney(safe / rate)
}

export function invoiceFromUsdAmount(
  usdAmount: number,
  currency: DealInvoiceCurrency,
  fxRate?: number | null,
): number {
  const safe = Number.isFinite(usdAmount) ? usdAmount : 0
  const rate = fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(currency)
  if (currency === "USD" || !rate) return roundDealMoney(safe)
  return roundDealMoney(safe * rate)
}

export function convertInvoiceSalePrice(
  amount: number,
  from: DealInvoiceCurrency,
  to: DealInvoiceCurrency,
  rates?: Partial<DealInvoiceFxRates> | null,
): number {
  if (from === to) return roundDealMoney(amount)
  return invoiceFromUsdAmount(
    usdFromInvoiceAmount(amount, from, invoiceFxRateFor(from, rates)),
    to,
    invoiceFxRateFor(to, rates),
  )
}

export function catalogPriceInInvoiceCurrency(
  usdPrice: number | null | undefined,
  currency: DealInvoiceCurrency,
  fxRate?: number | null,
): number {
  return invoiceFromUsdAmount(
    Number(usdPrice ?? 0),
    currency,
    fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(currency),
  )
}

export function dealLineEditorSalePrice(
  line: { unit_sale_price: number; invoice_unit_sale_price?: number | null },
  currency: DealInvoiceCurrency,
  fxRate?: number | null,
): number {
  if (isNonUsdInvoiceCurrency(currency)) {
    const invoicePrice = line.invoice_unit_sale_price
    if (invoicePrice != null && Number.isFinite(Number(invoicePrice))) {
      return Number(invoicePrice)
    }
    return invoiceFromUsdAmount(
      Number(line.unit_sale_price),
      currency,
      fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(currency),
    )
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
  const currency = parseDealInvoiceCurrency(deal.invoice_currency)
  if (!isNonUsdInvoiceCurrency(currency)) return null
  const invoiceTotal = Number(deal.invoice_total_amount ?? 0)
  const usdTotal = Number(deal.total_amount ?? 0)
  const rate = Number(deal.invoice_fx_rate ?? invoiceFxRateFor(currency))
  return `Invoiced in ${formatMoney(currency, invoiceTotal)}. CRM value is ${formatMoney("USD", usdTotal)} at ${rate}. This was not a USD invoice.`
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
  fxRate?: number | null,
): { invoiceUnitPrice: number; usdUnitPrice: number; fxRate: number } {
  const invoicePrice = roundDealMoney(invoiceUnitPrice)
  const rate = fxRate && fxRate > 0 ? fxRate : invoiceFxRateFor(invoiceCurrency)
  return {
    invoiceUnitPrice: invoicePrice,
    usdUnitPrice: usdFromInvoiceAmount(invoicePrice, invoiceCurrency, rate),
    fxRate: rate,
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
    fxRate?: number | null
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
  const fxRate = input.fxRate && input.fxRate > 0 ? input.fxRate : invoiceFxRateFor(input.invoiceCurrency)
  const { error: dealError } = await supabase
    .from("deals")
    .update({
      invoice_currency: input.invoiceCurrency,
      invoice_fx_rate: fxRate,
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
