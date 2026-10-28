import {
  invoiceFxRateFor,
  isNonUsdInvoiceCurrency,
  parseDealInvoiceCurrency,
} from "@/lib/crm/deal-invoice-currency"
import { xeroRequest } from "@/lib/integrations/xero/client"
import { getIntegrationSetting, setIntegrationSetting } from "@/lib/integrations/xero/settings-store"

type TaxRate = {
  TaxType?: string
  Status?: string
  Name?: string
  CanApplyToRevenue?: boolean
  EffectiveRate?: number
}
type XeroAccount = { Code?: string; Name?: string; Type?: string; TaxType?: string; Status?: string }
type XeroItem = { Code?: string; Name?: string; IsSold?: boolean }

export const XERO_ORG_DEFAULTS_CACHE_KEY = "xero_org_defaults_cache"
export const XERO_ORG_DEFAULTS_TTL_MS = 6 * 60 * 60 * 1000
export const XERO_ORG_DEFAULTS_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000

export type XeroOrgDefaultsCache = {
  accountCode: string
  taxType: string
  itemCode: string | null
  currencies: string[]
  baseCurrency: string | null
  abuDhabiTaxType?: string | null
  envFingerprint: string
  fetchedAt: string
}

type LoadedOrgDefaults = {
  accountCode: string
  taxType: string
  itemCode: string | null
  currencies: Set<string>
  baseCurrency: string | null
  abuDhabiTaxType?: string | null
}

let memoryCache: XeroOrgDefaultsCache | null = null

export function xeroOrgEnvFingerprint(): string {
  return [
    process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200",
    process.env.XERO_INVOICE_TAX_TYPE?.trim() || "",
    process.env.XERO_ABU_DHABI_TAX_TYPE?.trim() || "TAX001",
    process.env.XERO_INVOICE_ITEM_CODE?.trim() || "1001",
    process.env.XERO_INVOICE_CURRENCY?.trim() || "",
  ].join("|")
}

export function preferredXeroAbuDhabiTaxType(): string {
  return process.env.XERO_ABU_DHABI_TAX_TYPE?.trim() || "TAX001"
}

/** Resolve the 5% revenue tax used on tax-inclusive Abu Dhabi invoice lines. */
export function selectXeroAbuDhabiTaxType(input: {
  rates: TaxRate[]
  preferred?: string | null
}): string | null {
  const active = input.rates.filter(
    (rate) => rate.Status === "ACTIVE" && rate.CanApplyToRevenue !== false && Boolean(rate.TaxType),
  )
  const preferred = input.preferred?.trim()
  if (preferred && active.some((rate) => rate.TaxType === preferred)) return preferred

  const fivePercent = active.filter((rate) => Number(rate.EffectiveRate) === 5)
  const namedFive = fivePercent.find((rate) => /dxb|uae|abu\s*dhabi|dubai/i.test(rate.Name ?? ""))
  if (namedFive?.TaxType) return namedFive.TaxType
  if (fivePercent[0]?.TaxType) return fivePercent[0].TaxType

  const named = active.find((rate) => /dxb|uae|abu\s*dhabi|dubai/i.test(rate.Name ?? ""))
  return named?.TaxType ?? null
}

/** Item codes carry their own tax defaults; omit them on tax-inclusive Abu Dhabi lines. */
export function xeroInvoiceItemCodeForLine(input: {
  itemCode?: string | null
  taxInclusive: boolean
}): string | undefined {
  if (input.taxInclusive) return undefined
  const code = input.itemCode?.trim()
  return code || undefined
}

export function parseXeroOrgDefaultsCache(
  value: string | null,
  now = Date.now(),
  fingerprint = xeroOrgEnvFingerprint(),
  options?: { allowStale?: boolean },
): XeroOrgDefaultsCache | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as XeroOrgDefaultsCache
    if (!parsed?.accountCode || !parsed?.taxType || !parsed.fetchedAt) return null
    if (!options?.allowStale && parsed.envFingerprint !== fingerprint) return null
    const fetched = Date.parse(parsed.fetchedAt)
    if (!Number.isFinite(fetched)) return null
    const maxAge = options?.allowStale ? XERO_ORG_DEFAULTS_MAX_STALE_MS : XERO_ORG_DEFAULTS_TTL_MS
    if (now - fetched > maxAge) return null
    if (!Array.isArray(parsed.currencies)) return null
    return {
      ...parsed,
      baseCurrency: typeof parsed.baseCurrency === "string" ? parsed.baseCurrency : null,
      abuDhabiTaxType:
        parsed.abuDhabiTaxType === undefined
          ? undefined
          : typeof parsed.abuDhabiTaxType === "string"
            ? parsed.abuDhabiTaxType
            : null,
    }
  } catch {
    return null
  }
}

function cacheToLoaded(cache: XeroOrgDefaultsCache): LoadedOrgDefaults {
  return {
    accountCode: cache.accountCode,
    taxType: cache.taxType,
    itemCode: cache.itemCode,
    currencies: new Set(
      cache.currencies.map((code) => code.trim().toUpperCase()).filter(Boolean),
    ),
    baseCurrency: cache.baseCurrency?.trim().toUpperCase() || null,
    abuDhabiTaxType: cache.abuDhabiTaxType,
  }
}

async function readPersistedOrgDefaults(
  now = Date.now(),
  allowStale = false,
): Promise<XeroOrgDefaultsCache | null> {
  if (memoryCache) {
    const stillValid = parseXeroOrgDefaultsCache(
      JSON.stringify(memoryCache),
      now,
      xeroOrgEnvFingerprint(),
      { allowStale },
    )
    if (stillValid) return stillValid
    if (!allowStale) memoryCache = null
  }
  const raw = await getIntegrationSetting(XERO_ORG_DEFAULTS_CACHE_KEY)
  const parsed = parseXeroOrgDefaultsCache(raw, now, xeroOrgEnvFingerprint(), { allowStale })
  if (parsed && !allowStale) memoryCache = parsed
  return parsed
}

function envFallbackOrgDefaults(): LoadedOrgDefaults {
  const itemCode = process.env.XERO_INVOICE_ITEM_CODE?.trim() || null
  return {
    accountCode: process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200",
    taxType: process.env.XERO_INVOICE_TAX_TYPE?.trim() || "OUTPUT",
    itemCode,
    currencies: new Set(["AED", "EUR", "GBP", "USD"]),
    baseCurrency: null,
    abuDhabiTaxType: preferredXeroAbuDhabiTaxType(),
  }
}

async function persistOrgDefaults(cache: XeroOrgDefaultsCache): Promise<void> {
  memoryCache = cache
  try {
    await setIntegrationSetting(XERO_ORG_DEFAULTS_CACHE_KEY, JSON.stringify(cache))
  } catch (e) {
    console.warn("[xero] Failed to persist org defaults cache:", e instanceof Error ? e.message : e)
  }
}

async function fetchTaxDefaults(): Promise<{
  accountCode: string
  taxType: string
  abuDhabiTaxType: string | null
}> {
  const accountCode = process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200"
  const envTax = process.env.XERO_INVOICE_TAX_TYPE?.trim()
  const taxRates = await xeroRequest<{ TaxRates?: TaxRate[] }>("GET", "/api.xro/2.0/TaxRates")
  const rates = taxRates.TaxRates ?? []
  const active = rates.filter((t) => t.Status === "ACTIVE" && t.CanApplyToRevenue !== false)
  const activeTaxTypes = new Set(active.map((t) => t.TaxType).filter((t): t is string => Boolean(t)))
  const abuDhabiTaxType = selectXeroAbuDhabiTaxType({
    rates,
    preferred: preferredXeroAbuDhabiTaxType(),
  })

  if (envTax && activeTaxTypes.has(envTax)) {
    return { accountCode, taxType: envTax, abuDhabiTaxType }
  }
  if (envTax) {
    console.warn(`[xero] Ignoring invalid XERO_INVOICE_TAX_TYPE "${envTax}" for revenue invoices.`)
  }

  const accounts = await xeroRequest<{ Accounts?: XeroAccount[] }>("GET", "/api.xro/2.0/Accounts")
  const accountTaxType = (accounts.Accounts ?? []).find(
    (a) => a.Code === accountCode && a.Status === "ACTIVE",
  )?.TaxType
  const taxType =
    (accountTaxType && activeTaxTypes.has(accountTaxType) ? accountTaxType : undefined) ??
    active.find((t) => t.TaxType === "OUTPUT")?.TaxType ??
    active.find((t) => t.TaxType === "OUTPUT2")?.TaxType ??
    active.find((t) => t.EffectiveRate === 0 && t.Name?.toLowerCase().includes("sales"))?.TaxType ??
    active.find((t) => t.TaxType === "NONE")?.TaxType ??
    active[0]?.TaxType ??
    "OUTPUT"

  return { accountCode, taxType, abuDhabiTaxType }
}

async function fetchInvoiceItemCode(): Promise<string | null> {
  const preferred = process.env.XERO_INVOICE_ITEM_CODE?.trim() || "1001"
  try {
    const res = await xeroRequest<{ Items?: XeroItem[] }>("GET", "/api.xro/2.0/Items")
    const items = res.Items ?? []
    const match =
      items.find((item) => item.Code?.trim().toLowerCase() === preferred.toLowerCase() && item.IsSold !== false) ??
      items.find((item) => item.Name?.trim().toLowerCase() === "tickets" && item.IsSold !== false)
    return match?.Code?.trim() || null
  } catch (e) {
    console.warn("[xero] Invoice item lookup skipped:", e instanceof Error ? e.message : e)
    return null
  }
}

async function fetchCurrencyCodes(): Promise<string[]> {
  const res = await xeroRequest<{ Currencies?: Array<{ Code?: string }> }>("GET", "/api.xro/2.0/Currencies")
  return (res.Currencies ?? [])
    .map((c) => c.Code?.trim().toUpperCase())
    .filter((code): code is string => Boolean(code))
}

async function fetchOrgBaseCurrency(): Promise<string | null> {
  try {
    const res = await xeroRequest<{ Organisations?: Array<{ BaseCurrency?: string }> }>(
      "GET",
      "/api.xro/2.0/Organisation",
    )
    return res.Organisations?.[0]?.BaseCurrency?.trim().toUpperCase() || null
  } catch (e) {
    console.warn("[xero] Organisation base currency lookup skipped:", e instanceof Error ? e.message : e)
    return null
  }
}

async function refreshOrgDefaults(): Promise<XeroOrgDefaultsCache> {
  const { accountCode, taxType, abuDhabiTaxType } = await fetchTaxDefaults()
  const [itemCode, currencies, baseCurrency] = await Promise.all([
    fetchInvoiceItemCode(),
    fetchCurrencyCodes(),
    fetchOrgBaseCurrency(),
  ])
  const record: XeroOrgDefaultsCache = {
    accountCode,
    taxType,
    itemCode,
    currencies,
    baseCurrency,
    abuDhabiTaxType,
    envFingerprint: xeroOrgEnvFingerprint(),
    fetchedAt: new Date().toISOString(),
  }
  await persistOrgDefaults(record)
  return record
}

async function loadXeroOrgDefaults(): Promise<LoadedOrgDefaults> {
  const fresh = await readPersistedOrgDefaults()
  if (fresh) return cacheToLoaded(fresh)

  const stale = await readPersistedOrgDefaults(Date.now(), true)
  if (stale) {
    memoryCache = stale
    return cacheToLoaded(stale)
  }

  try {
    return cacheToLoaded(await refreshOrgDefaults())
  } catch (error) {
    console.warn(
      "[xero] Org defaults lookup failed, using env fallbacks:",
      error instanceof Error ? error.message : error,
    )
    return envFallbackOrgDefaults()
  }
}

/** Refresh expired Xero tax/account defaults after invoicing, never on the invoice hot path. */
export async function refreshXeroOrgDefaultsBestEffort(): Promise<void> {
  const fresh = await readPersistedOrgDefaults()
  if (fresh) return
  try {
    await refreshOrgDefaults()
  } catch (error) {
    console.warn(
      "[xero] Org defaults refresh failed; invoices will keep using cached settings:",
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * UK and most Xero orgs require AccountCode + TaxType on invoice line items.
 * Defaults: Sales account 200, using the connected Xero account's default revenue tax code when possible.
 */
export async function getXeroInvoiceLineDefaults(): Promise<{ accountCode: string; taxType: string }> {
  const loaded = await loadXeroOrgDefaults()
  return { accountCode: loaded.accountCode, taxType: loaded.taxType }
}

export async function getXeroInvoiceItemCode(): Promise<string | undefined> {
  const loaded = await loadXeroOrgDefaults()
  return loaded.itemCode ?? undefined
}

export async function getXeroAbuDhabiTaxType(): Promise<string | null> {
  const loaded = await loadXeroOrgDefaults()
  if (loaded.abuDhabiTaxType !== undefined) return loaded.abuDhabiTaxType
  return preferredXeroAbuDhabiTaxType()
}

export function selectXeroInvoiceCurrency(input: {
  invoiceCurrency: string
  orgCurrencies: Iterable<string>
  override?: string | null
}): string | undefined {
  const requested = input.invoiceCurrency.trim().toUpperCase() || "USD"
  const currencies = new Set(
    [...input.orgCurrencies].map((code) => code.trim().toUpperCase()).filter(Boolean),
  )
  if (isNonUsdInvoiceCurrency(requested)) {
    if (!currencies.has(requested)) {
      throw new Error(
        `This Xero organisation does not have ${requested} enabled. Enable ${requested} in Xero before invoicing this deal.`,
      )
    }
    return requested
  }
  const override = input.override?.trim().toUpperCase()
  if (override && !isNonUsdInvoiceCurrency(override)) return override
  return currencies.has(requested) ? requested : undefined
}

/** Xero CurrencyRate converts invoice currency into the org base currency. */
export function selectXeroInvoiceCurrencyRate(input: {
  invoiceCurrency: string
  orgBaseCurrency?: string | null
  fxRate?: number | null
}): number | undefined {
  const requested = parseDealInvoiceCurrency(input.invoiceCurrency)
  if (!isNonUsdInvoiceCurrency(requested)) return undefined
  const base = (input.orgBaseCurrency || "USD").trim().toUpperCase()
  if (base !== "USD") return undefined
  const invoicePerUsd =
    input.fxRate && input.fxRate > 0 ? input.fxRate : invoiceFxRateFor(requested)
  return Math.round((1 / invoicePerUsd + Number.EPSILON) * 1_000_000) / 1_000_000
}

/** Use invoice currency when the Xero org supports it; otherwise omit (org base currency). */
export async function resolveXeroInvoiceCurrency(invoiceCurrency: string): Promise<string | undefined> {
  const loaded = await loadXeroOrgDefaults()
  return selectXeroInvoiceCurrency({
    invoiceCurrency,
    orgCurrencies: loaded.currencies,
    override: process.env.XERO_INVOICE_CURRENCY,
  })
}

export async function resolveXeroInvoiceCurrencyRate(
  invoiceCurrency: string,
  fxRate?: number | null,
): Promise<number | undefined> {
  const loaded = await loadXeroOrgDefaults()
  return selectXeroInvoiceCurrencyRate({
    invoiceCurrency,
    orgBaseCurrency: loaded.baseCurrency,
    fxRate,
  })
}
