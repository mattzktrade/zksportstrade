export function adminDealPath(dealId: string): string {
  return `/admin/deals/${encodeURIComponent(dealId)}`
}

/** Linked portal/offline sales open the deal workspace. Unlinked orders have no deal page. */
export function adminOrderDealPath(dealId: string | null | undefined): string | null {
  const id = typeof dealId === "string" ? dealId.trim() : ""
  return id ? adminDealPath(id) : null
}
