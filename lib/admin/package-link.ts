export type AdminPackageTab = "details" | "guest-list" | "inventory" | "orders" | "visibility"

export function adminPackagePath(packageId: string, tab?: AdminPackageTab | "integrations"): string {
  const base = `/admin/catalog/${encodeURIComponent(packageId)}`
  if (tab === "guest-list") return `${base}?tab=guest-list`
  if (tab === "orders") return `${base}?tab=orders`
  if (tab === "inventory") return `${base}?tab=inventory`
  if (tab === "visibility" || tab === "integrations") return `${base}?tab=visibility`
  return base
}

export function parseAdminPackageTab(param: string | null): AdminPackageTab {
  if (param === "guest-list") return "guest-list"
  if (param === "orders") return "orders"
  if (param === "inventory") return "inventory"
  if (param === "visibility" || param === "integrations") return "visibility"
  return "details"
}
