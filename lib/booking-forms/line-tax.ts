export function bookingLineTax(
  eventName: string,
  lineTotal: number,
): { taxRate: number; taxAmountIncluded: number } {
  const taxRate = /abu\s*dhabi/i.test(eventName) ? 0.05 : 0
  return {
    taxRate,
    taxAmountIncluded: taxRate > 0 ? lineTotal - lineTotal / (1 + taxRate) : 0,
  }
}
