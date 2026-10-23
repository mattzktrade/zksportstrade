"use client"

import { useEffect, useState } from "react"
import { getDealInvoiceFxRates } from "@/app/(admin)/admin/deals/deal-edit-actions"
import {
  DEAL_INVOICE_CURRENCIES,
  FALLBACK_INVOICE_FX_RATES,
  invoiceCurrencyHelpText,
  type DealInvoiceCurrency,
  type DealInvoiceFxRates,
} from "@/lib/crm/deal-invoice-currency"
import { cn } from "@/lib/utils"

export function useDealInvoiceFxRates(): DealInvoiceFxRates {
  const [rates, setRates] = useState<DealInvoiceFxRates>(FALLBACK_INVOICE_FX_RATES)
  useEffect(() => {
    let cancelled = false
    void getDealInvoiceFxRates()
      .then((next) => {
        if (!cancelled) setRates(next)
      })
      .catch(() => {
        if (!cancelled) setRates(FALLBACK_INVOICE_FX_RATES)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return rates
}

export function DealInvoiceCurrencyToggle({
  value,
  onChange,
  disabled = false,
  compact = false,
  fxRate,
}: {
  value: DealInvoiceCurrency
  onChange: (currency: DealInvoiceCurrency) => void
  disabled?: boolean
  compact?: boolean
  fxRate?: number | null
}) {
  const help = invoiceCurrencyHelpText(value, fxRate)
  return (
    <div>
      <p className={cn("mb-1 font-medium text-slate-500", compact ? "text-[8px]" : "text-xs")}>
        Invoice currency
      </p>
      <div
        className={cn(
          "inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5",
          compact ? "text-[8px]" : "text-sm",
        )}
      >
        {DEAL_INVOICE_CURRENCIES.map((currency) => (
          <button
            key={currency}
            type="button"
            disabled={disabled}
            onClick={() => onChange(currency)}
            className={cn(
              "rounded px-2.5 font-medium disabled:opacity-50",
              compact ? "h-7" : "h-8",
              value === currency ? "bg-primary text-white" : "text-slate-600 hover:bg-white",
            )}
          >
            {currency}
          </button>
        ))}
      </div>
      {help ? (
        <p className={cn("mt-1 text-slate-500", compact ? "text-[8px]" : "text-xs")}>{help}</p>
      ) : null}
    </div>
  )
}
