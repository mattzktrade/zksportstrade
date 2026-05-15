export type AdminPackageTab = "details" | "inventory" | "orders"

export function adminPackagePath(packageId: string, tab?: AdminPackageTab): string {
  const base = `/admin/catalog/${encodeURIComponent(packageId)}`
  if (tab === "orders") return `${base}?tab=orders`
  if (tab === "inventory") return `${base}?tab=inventory`
  return base
}

export function parseAdminPackageTab(param: string | null): AdminPackageTab {
  if (param === "orders") return "orders"
  if (param === "inventory") return "inventory"
  return "details"
}
