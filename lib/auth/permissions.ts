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

/** Admin and finance: day-to-day CMS work. Settings and sending booking forms stay admin-only. */
export function isCmsOperator(profile: Pick<PortalProfile, "role"> | null | undefined): boolean {
  return profile?.role === "admin" || profile?.role === "finance"
}

export function hasCmsPermission(
  profile: Pick<PortalProfile, "role"> | null | undefined,
  permission: CmsPermission,
): boolean {
  if (!profile || !isCmsRole(profile.role)) return false
  return ROLE_PERMISSIONS[profile.role].includes(permission)
}

/** Sales, finance, and admin can create and amend booking forms. */
export function canPrepareNativeBookingForm(
  profile: Pick<PortalProfile, "role"> | null | undefined,
): boolean {
  return isCmsStaff(profile)
}

/** Only the admin role can email a booking form to the client. */
export function canSendNativeBookingForm(
  profile: Pick<PortalProfile, "role"> | null | undefined,
): boolean {
  return profile?.role === "admin"
}

/** Admin and finance can countersign after the client has signed. */
export function canSignNativeBookingForm(
  profile: Pick<PortalProfile, "role"> | null | undefined,
): boolean {
  return isCmsOperator(profile)
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
    summary: "Same as admin for day-to-day work, except Settings and sending booking forms.",
    can: [
      "Accounts, deals, operations, finance, inventory, purchase orders, and suppliers",
      "Own deals and assign deal owners",
      "Create, amend, and countersign booking forms (an admin must send them)",
      "Cannot open Settings or connect integrations",
    ],
  },
  sales: {
    label: "Sales",
    summary: "Day-to-day selling: accounts, deals, and operations.",
    can: [
      "Create and manage accounts and deals",
      "Place inventory holds",
      "Create and amend booking forms (an admin must send them)",
      "View orders and run operations",
    ],
  },
}

export const CMS_STAFF_ROLES: CmsRole[] = ["admin", "finance", "sales"]
