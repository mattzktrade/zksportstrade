"use client"

import { ACCOUNT_KIND_OPTIONS, type AccountKind } from "@/lib/crm/account-kinds"
import { cn } from "@/lib/utils"

export function AccountKindPills({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: AccountKind[]
  onChange: (next: AccountKind[]) => void
  disabled?: boolean
  compact?: boolean
}) {
  function toggle(kind: AccountKind) {
    if (disabled) return
    onChange(
      value.includes(kind) ? value.filter((item) => item !== kind) : [...value, kind],
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ACCOUNT_KIND_OPTIONS.map((option) => {
        const selected = value.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(option.id)}
            className={cn(
              "rounded-full border px-3 font-medium transition-colors disabled:opacity-50",
              compact ? "h-7 text-[9px]" : "h-9 text-sm",
              selected
                ? "border-primary bg-red-50 text-primary"
                : "border-[#e5e7eb] bg-white text-[#5f636b] hover:bg-slate-50",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
