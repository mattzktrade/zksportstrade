export type BuyPriceLine = {
  unitCost: number
  unitCostConfirmed?: boolean
}

export type PurchaseOrderBuyPriceState = "recorded" | "awaiting" | "confirmed"

export const PURCHASE_ORDERS_AWAITING_BUY_PRICE_HREF = "/admin/purchase-orders?buyPrice=awaiting"

export const PURCHASE_ORDER_BUY_PRICE_FILTERS = ["awaiting"] as const
export type PurchaseOrderBuyPriceFilter = (typeof PURCHASE_ORDER_BUY_PRICE_FILTERS)[number]

export function isPurchaseOrderBuyPriceFilter(
  value: string | null | undefined,
): value is PurchaseOrderBuyPriceFilter {
  return typeof value === "string" && (PURCHASE_ORDER_BUY_PRICE_FILTERS as readonly string[]).includes(value)
}

/** A positive buy price is already recorded. Zero counts only after staff confirm it. */
export function lineAwaitsBuyPrice(line: BuyPriceLine): boolean {
  return line.unitCost === 0 && line.unitCostConfirmed !== true
}

export function purchaseOrderBuyPriceState(lines: readonly BuyPriceLine[]): PurchaseOrderBuyPriceState {
  const zeros = lines.filter((line) => line.unitCost === 0)
  if (zeros.length === 0) return "recorded"
  if (zeros.every((line) => line.unitCostConfirmed === true)) return "confirmed"
  return "awaiting"
}

export function purchaseOrderAwaitsBuyPrice(lines: readonly BuyPriceLine[]): boolean {
  return purchaseOrderBuyPriceState(lines) === "awaiting"
}

export function countPurchaseOrdersAwaitingBuyPrice(
  orders: readonly { lines: readonly BuyPriceLine[] }[],
): number {
  return orders.filter((order) => purchaseOrderAwaitsBuyPrice(order.lines)).length
}
