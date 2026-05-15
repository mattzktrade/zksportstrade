import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(amount: number, currency = "USD") {
  const code = currency.trim() || "USD"
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(amount)
  } catch {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD" }).format(amount)
  }
}
