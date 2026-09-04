export function adminDealPath(dealId: string): string {
  return `/admin/deals/${encodeURIComponent(dealId)}`
}

/** Linked portal/offline sales open the deal workspace. Unlinked orders have no deal page. */
export function adminOrderDealPath(dealId: string | null | undefined): string | null {
  const id = typeof dealId === "string" ? dealId.trim() : ""
  return id ? adminDealPath(id) : null
}

export const BOOKING_FORMS_AWAITING_APPROVAL_PIPELINE = "awaiting_approval"

/** Deep-link to the deal that needs ZK signature, or the filtered pipeline if several. */
export function bookingFormsAwaitingApprovalHref(dealIds: readonly string[]): string {
  const unique: string[] = []
  for (const raw of dealIds) {
    const id = raw.trim()
    if (!id || unique.includes(id)) continue
    unique.push(id)
  }
  if (unique.length === 1 && unique[0]) return adminDealPath(unique[0])
  return `/admin/deals?pipeline=${BOOKING_FORMS_AWAITING_APPROVAL_PIPELINE}`
}
