export function adminDealPath(dealId: string): string {
  return `/admin/deals/${encodeURIComponent(dealId)}`
}
