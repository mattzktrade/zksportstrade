import { xeroRequest } from "@/lib/integrations/xero/client"

type TaxRate = { TaxType?: string; Status?: string; Name?: string }

let cached: { accountCode: string; taxType: string } | null = null
let cachedCurrencyCodes: Set<string> | null = null

/**
 * UK and most Xero orgs require AccountCode + TaxType on invoice line items.
 * Defaults: Sales account 200, first active income VAT code (OUTPUT2 in UK demo orgs).
 */
export async function getXeroInvoiceLineDefaults(): Promise<{ accountCode: string; taxType: string }> {
  if (cached) return cached

  const accountCode = process.env.XERO_SALES_ACCOUNT_CODE?.trim() || "200"
  const envTax = process.env.XERO_INVOICE_TAX_TYPE?.trim()
  if (envTax) {
    cached = { accountCode, taxType: envTax }
    return cached
  }

  const taxRates = await xeroRequest<{ TaxRates?: TaxRate[] }>("GET", "/api.xro/2.0/TaxRates")
  const active = (taxRates.TaxRates ?? []).filter((t) => t.Status === "ACTIVE")
  const taxType =
    active.find((t) => t.TaxType === "OUTPUT2")?.TaxType ??
    active.find((t) => t.Name?.toLowerCase().includes("income"))?.TaxType ??
    active.find((t) => t.TaxType === "NONE")?.TaxType ??
    active[0]?.TaxType ??
    "OUTPUT2"

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
