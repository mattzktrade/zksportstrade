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

export type XeroOrgDefaultsCache = {
  accountCode: string
  taxType: string
  itemCode: string | null
  currencies: string[]
  envFingerprint: string
  fetchedAt: string
}

type LoadedOrgDefaults = {
  accountCode: string
  taxType: string
  itemCode: string | null
  currencies: Set<string>
}

let memoryCache: XeroOrgDefaultsCache | null = null

export function xeroOrgEnvFingerprint(): string {
  return [
    process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200",
    process.env.XERO_INVOICE_TAX_TYPE?.trim() || "",
    process.env.XERO_INVOICE_ITEM_CODE?.trim() || "1001",
    process.env.XERO_INVOICE_CURRENCY?.trim() || "",
  ].join("|")
}

export function parseXeroOrgDefaultsCache(
  value: string | null,
  now = Date.now(),
  fingerprint = xeroOrgEnvFingerprint(),
): XeroOrgDefaultsCache | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as XeroOrgDefaultsCache
    if (!parsed?.accountCode || !parsed?.taxType || !parsed.fetchedAt) return null
    if (parsed.envFingerprint !== fingerprint) return null
    const fetched = Date.parse(parsed.fetchedAt)
    if (!Number.isFinite(fetched) || now - fetched > XERO_ORG_DEFAULTS_TTL_MS) return null
    if (!Array.isArray(parsed.currencies)) return null
    return parsed
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
  }
}

async function readPersistedOrgDefaults(now = Date.now()): Promise<XeroOrgDefaultsCache | null> {
  if (memoryCache) {
    const stillValid = parseXeroOrgDefaultsCache(JSON.stringify(memoryCache), now)
    if (stillValid) return stillValid
    memoryCache = null
  }
  const raw = await getIntegrationSetting(XERO_ORG_DEFAULTS_CACHE_KEY)
  const parsed = parseXeroOrgDefaultsCache(raw, now)
  if (parsed) memoryCache = parsed
  return parsed
}

async function persistOrgDefaults(cache: XeroOrgDefaultsCache): Promise<void> {
  memoryCache = cache
  try {
    await setIntegrationSetting(XERO_ORG_DEFAULTS_CACHE_KEY, JSON.stringify(cache))
  } catch (e) {
    console.warn("[xero] Failed to persist org defaults cache:", e instanceof Error ? e.message : e)
  }
}

async function fetchTaxDefaults(): Promise<{ accountCode: string; taxType: string }> {
  const accountCode = process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200"
  const envTax = process.env.XERO_INVOICE_TAX_TYPE?.trim()
  const taxRates = await xeroRequest<{ TaxRates?: TaxRate[] }>("GET", "/api.xro/2.0/TaxRates")
  const active = (taxRates.TaxRates ?? []).filter(
    (t) => t.Status === "ACTIVE" && t.CanApplyToRevenue !== false,
  )
  const activeTaxTypes = new Set(active.map((t) => t.TaxType).filter((t): t is string => Boolean(t)))

  if (envTax && activeTaxTypes.has(envTax)) {
    return { accountCode, taxType: envTax }
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

  return { accountCode, taxType }
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
  const override = process.env.XERO_INVOICE_CURRENCY?.trim().toUpperCase()
  if (override) return [override]
  const res = await xeroRequest<{ Currencies?: Array<{ Code?: string }> }>("GET", "/api.xro/2.0/Currencies")
  return (res.Currencies ?? [])
    .map((c) => c.Code?.trim().toUpperCase())
    .filter((code): code is string => Boolean(code))
}

async function loadXeroOrgDefaults(): Promise<LoadedOrgDefaults> {
  const cached = await readPersistedOrgDefaults()
  if (cached) return cacheToLoaded(cached)

  const { accountCode, taxType } = await fetchTaxDefaults()
  const [itemCode, currencies] = await Promise.all([fetchInvoiceItemCode(), fetchCurrencyCodes()])
  const record: XeroOrgDefaultsCache = {
    accountCode,
    taxType,
    itemCode,
    currencies,
    envFingerprint: xeroOrgEnvFingerprint(),
    fetchedAt: new Date().toISOString(),
  }
  await persistOrgDefaults(record)
  return cacheToLoaded(record)
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

/** Use order currency when the Xero org supports it; otherwise omit (org base currency). */
export async function resolveXeroInvoiceCurrency(orderCurrency: string): Promise<string | undefined> {
  const override = process.env.XERO_INVOICE_CURRENCY?.trim().toUpperCase()
  if (override) return override

  const order = orderCurrency.trim().toUpperCase() || "USD"
  const loaded = await loadXeroOrgDefaults()
  return loaded.currencies.has(order) ? order : undefined
}
