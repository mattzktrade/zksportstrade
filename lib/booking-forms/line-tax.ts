export const BOOKING_VAT_RATE = 0.05

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isAbuDhabiEvent(eventName: string): boolean {
  return /abu\s*dhabi/i.test(eventName)
}

export function includedVatAmount(gross: number, rate = BOOKING_VAT_RATE): number {
  if (rate <= 0 || !(gross > 0)) return 0
  return roundMoney(gross - gross / (1 + rate))
}

export function bookingLineTax(
  eventName: string,
  lineTotal: number,
): { taxRate: number; taxAmountIncluded: number } {
  const taxRate = isAbuDhabiEvent(eventName) ? BOOKING_VAT_RATE : 0
  return {
    taxRate,
    taxAmountIncluded: includedVatAmount(lineTotal, taxRate),
  }
}

export function defaultNoVat(lines: Array<{ eventName: string }>): boolean {
  return !lines.some((line) => isAbuDhabiEvent(line.eventName))
}

export function applyInclusiveVat(
  lineTotal: number,
  includeVat: boolean,
): { taxRate: number; taxAmountIncluded: number } {
  if (!includeVat) return { taxRate: 0, taxAmountIncluded: 0 }
  return { taxRate: BOOKING_VAT_RATE, taxAmountIncluded: includedVatAmount(lineTotal) }
}
