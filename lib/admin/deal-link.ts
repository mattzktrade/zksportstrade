export function adminDealPath(dealId: string): string {
  return `/admin/deals/${encodeURIComponent(dealId)}`
}

/** Linked portal/offline sales open the deal workspace. Unlinked orders have no deal page. */
export function adminOrderDealPath(dealId: string | null | undefined): string | null {
  const id = typeof dealId === "string" ? dealId.trim() : ""
  return id ? adminDealPath(id) : null
}

export const BOOKING_FORMS_AWAITING_APPROVAL_PIPELINE = "awaiting_approval"

export function uniqueDealIds(ids: readonly string[]): string[] {
  const unique: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || unique.includes(id)) continue
    unique.push(id)
  }
  return unique
}

/** Dashboard and Deals both treat live booking-form status as the source of truth. */
export function isAwaitingZkApprovalDeal(
  dealId: string,
  awaitingDealIds: ReadonlySet<string> | readonly string[],
): boolean {
  const id = dealId.trim()
  if (!id) return false
  return [...awaitingDealIds].includes(id)
}

/** Deep-link to the deal that needs ZK signature, or the filtered pipeline if several. */
export function bookingFormsAwaitingApprovalHref(dealIds: readonly string[]): string {
  const unique = uniqueDealIds(dealIds)
  if (unique.length === 1 && unique[0]) return adminDealPath(unique[0])
  return `/admin/deals?pipeline=${BOOKING_FORMS_AWAITING_APPROVAL_PIPELINE}`
}
