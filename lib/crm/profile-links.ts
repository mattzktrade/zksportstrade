export type CompanyProfileTab = "customer" | "supplier"

export function adminAccountPath(accountId: string, tab?: CompanyProfileTab): string {
  const base = `/admin/clients/${encodeURIComponent(accountId)}`
  return tab === "supplier" ? `${base}?tab=supplier` : base
}

export function adminContactPath(accountId: string, contactId: string): string {
  return `${adminAccountPath(accountId)}/contacts/${encodeURIComponent(contactId)}`
}

export function adminSupplierPath(supplierId: string): string {
  return `/admin/suppliers/${encodeURIComponent(supplierId)}`
}
