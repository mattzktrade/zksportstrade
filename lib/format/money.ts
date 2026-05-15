/**
 * Fixed locale for currency/number display so SSR and the browser hydrate identically.
 * (undefined locale uses server OS vs client browser and causes mismatches like $ vs US$.)
 */
export const APP_NUMBER_LOCALE = "en-US"

export function formatMoney(currency: string, amount: number): string {
  const code = (currency || "USD").trim() || "USD"
  const safe = code.length === 3 ? code : "USD"
  try {
    return new Intl.NumberFormat(APP_NUMBER_LOCALE, {
      style: "currency",
      currency: safe,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${safe} ${amount.toFixed(2)}`
  }
}

export function formatMoneyCompact(currency: string, amount: number, maximumFractionDigits = 0): string {
  const code = (currency || "USD").trim() || "USD"
  const safe = code.length === 3 ? code : "USD"
  try {
    return new Intl.NumberFormat(APP_NUMBER_LOCALE, {
      style: "currency",
      currency: safe,
      maximumFractionDigits,
    }).format(amount)
  } catch {
    return `${safe} ${amount.toFixed(maximumFractionDigits)}`
  }
}
