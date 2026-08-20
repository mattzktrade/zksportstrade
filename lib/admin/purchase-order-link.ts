export function purchaseOrderAdminHref(poId: string): string {
  return `/admin/purchase-orders?po=${encodeURIComponent(poId)}`
}
