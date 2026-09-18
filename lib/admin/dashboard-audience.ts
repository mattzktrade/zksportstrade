import { DEFAULT_CHELLEY_CC, DEFAULT_OPERATIONS_CC } from "@/lib/email/config"

const OPERATIONS_DASHBOARD_EMAILS = new Set(
  [DEFAULT_CHELLEY_CC, DEFAULT_OPERATIONS_CC].map((email) => email.trim().toLowerCase()),
)

/** Operations staff (Jenny) and Chelley see the operations dashboard, even if their CMS role is finance or admin. */
export function isOperationsDashboardUser(profile: {
  role?: string | null
  email?: string | null
  full_name?: string | null
}): boolean {
  const email = (profile.email ?? "").trim().toLowerCase()
  if (email && OPERATIONS_DASHBOARD_EMAILS.has(email)) return true
  const name = (profile.full_name ?? "").trim().toLowerCase()
  if (name.includes("chelley")) return true
  if (name === "jenny kent" || name.startsWith("jenny kent ")) return true
  return profile.role === "operations"
}

/** Sales staff see the sales dashboard. Operations identity still wins on the home route. */
export function isSalesDashboardUser(profile: { role?: string | null }): boolean {
  return profile.role === "sales"
}
