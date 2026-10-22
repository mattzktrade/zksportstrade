"use client"

import { DEAL_INVOICE_CURRENCIES, type DealInvoiceCurrency } from "@/lib/crm/deal-invoice-currency"
import { cn } from "@/lib/utils"

export function DealInvoiceCurrencyToggle({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: DealInvoiceCurrency
  onChange: (currency: DealInvoiceCurrency) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div>
      <p className={cn("mb-1 font-medium text-slate-500", compact ? "text-[8px]" : "text-xs")}>
        Invoice currency
      </p>
      <div
        className={cn(
          "inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5",
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
              "rounded px-3 font-medium disabled:opacity-50",
              compact ? "h-7" : "h-8",
              value === currency ? "bg-primary text-white" : "text-slate-600 hover:bg-white",
            )}
          >
            {currency}
          </button>
        ))}
      </div>
      {value === "AED" ? (
        <p className={cn("mt-1 text-slate-500", compact ? "text-[8px]" : "text-xs")}>
          Sale prices are in AED. The CRM stores the official USD conversion at 3.6725 for stats.
        </p>
      ) : null}
    </div>
  )
}
