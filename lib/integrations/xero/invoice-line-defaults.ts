import { xeroRequest } from "@/lib/integrations/xero/client"

type TaxRate = {
  TaxType?: string
  Status?: string
  Name?: string
  CanApplyToRevenue?: boolean
  EffectiveRate?: number
}
type XeroAccount = { Code?: string; Name?: string; Type?: string; TaxType?: string; Status?: string }

let cached: { accountCode: string; taxType: string } | null = null
let cachedCurrencyCodes: Set<string> | null = null

/**
 * UK and most Xero orgs require AccountCode + TaxType on invoice line items.
 * Defaults: Sales account 200, using the connected Xero account's default revenue tax code when possible.
 */
export async function getXeroInvoiceLineDefaults(): Promise<{ accountCode: string; taxType: string }> {
  if (cached) return cached

  const accountCode = process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200"
  const envTax = process.env.XERO_INVOICE_TAX_TYPE?.trim()
  const taxRates = await xeroRequest<{ TaxRates?: TaxRate[] }>("GET", "/api.xro/2.0/TaxRates")
  const active = (taxRates.TaxRates ?? []).filter(
    (t) => t.Status === "ACTIVE" && t.CanApplyToRevenue !== false,
  )
  const activeTaxTypes = new Set(active.map((t) => t.TaxType).filter((t): t is string => Boolean(t)))

  if (envTax && activeTaxTypes.has(envTax)) {
    cached = { accountCode, taxType: envTax }
    return cached
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

  cached = { accountCode, taxType }
  return cached
}

async function getXeroCurrencyCodes(): Promise<Set<string>> {
  if (cachedCurrencyCodes) return cachedCurrencyCodes
  const res = await xeroRequest<{ Currencies?: Array<{ Code?: string }> }>("GET", "/api.xro/2.0/Currencies")
  cachedCurrencyCodes = new Set(
    (res.Currencies ?? []).map((c) => c.Code?.trim().toUpperCase()).filter((c): c is string => Boolean(c)),
  )
  return cachedCurrencyCodes
}

/** Use order currency when the Xero org supports it; otherwise omit (org base currency). */
export async function resolveXeroInvoiceCurrency(orderCurrency: string): Promise<string | undefined> {
  const override = process.env.XERO_INVOICE_CURRENCY?.trim().toUpperCase()
  if (override) return override

  const order = orderCurrency.trim().toUpperCase() || "USD"
  const codes = await getXeroCurrencyCodes()
  return codes.has(order) ? order : undefined
}
