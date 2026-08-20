import type { PortalProfile } from "@/lib/types/profile"

export type CmsRole = "admin" | "finance" | "sales"
export type PortalRole = CmsRole | "agent"

export type CmsPermission =
  | "cms.access"
  | "inventory.view"
  | "inventory.manage"
  | "inventory.purchase"
  | "inventory.adjust"
  | "inventory.archive"
  | "inventory.hold"
  | "pricing.manage"
  | "deals.view"
  | "deals.manage"
  | "accounts.manage"
  | "orders.view"
  | "operations.view"
  | "operations.manage"
  | "finance.view"
  | "finance.manage"
  | "integrations.manage"
  | "users.manage"
  | "settings.manage"

const ROLE_PERMISSIONS: Record<CmsRole, readonly CmsPermission[]> = {
  admin: [
    "cms.access",
    "inventory.view",
    "inventory.manage",
    "inventory.purchase",
    "inventory.adjust",
    "inventory.archive",
    "inventory.hold",
    "pricing.manage",
    "deals.view",
    "deals.manage",
    "accounts.manage",
    "orders.view",
    "operations.view",
    "operations.manage",
    "finance.view",
    "finance.manage",
    "integrations.manage",
    "users.manage",
    "settings.manage",
  ],
  finance: [
    "cms.access",
    "inventory.view",
    "deals.view",
    "orders.view",
    "operations.view",
    "finance.view",
    "finance.manage",
  ],
  sales: [
    "cms.access",
    "inventory.view",
    "inventory.hold",
    "deals.view",
    "deals.manage",
    "accounts.manage",
    "orders.view",
    "operations.view",
    "operations.manage",
  ],
}

export function isCmsRole(role: string | null | undefined): role is CmsRole {
  return role === "admin" || role === "finance" || role === "sales"
}

export function isCmsStaff(profile: Pick<PortalProfile, "role"> | null | undefined): boolean {
  return isCmsRole(profile?.role)
}

export function hasCmsPermission(
  profile: Pick<PortalProfile, "role"> | null | undefined,
  permission: CmsPermission,
): boolean {
  if (!profile || !isCmsRole(profile.role)) return false
  return ROLE_PERMISSIONS[profile.role].includes(permission)
}

export function cmsRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return "Admin"
    case "finance":
      return "Finance"
    case "sales":
      return "Sales"
    case "agent":
      return "Agent"
    default:
      return "User"
  }
}

export const CMS_ROLE_GUIDES: Record<
  CmsRole,
  { label: string; summary: string; can: string[] }
> = {
  admin: {
    label: "Admin",
    summary: "Full access, including team logins and integrations.",
    can: [
      "Inventory, pricing, purchase orders, and catalog",
      "Accounts, deals, operations, and finance",
      "Connect Xero, Wix, and other integrations",
      "Create, update, and remove team logins",
    ],
  },
  finance: {
    label: "Finance",
    summary: "Invoices and payments, with a read-only view of the pipeline.",
    can: [
      "View and manage invoices and payments",
      "View deals, orders, operations, and inventory",
    ],
  },
  sales: {
    label: "Sales",
    summary: "Day-to-day selling: accounts, deals, and operations.",
    can: [
      "Create and manage accounts and deals",
      "Place inventory holds",
      "View orders and run operations",
    ],
  },
}

export const CMS_STAFF_ROLES: CmsRole[] = ["admin", "finance", "sales"]
