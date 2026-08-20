import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { listCmsStaffUsers } from "@/lib/admin/settings-users"
import { getXeroConnectionStatus } from "@/lib/integrations/xero/settings-store"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { SettingsClient, type SettingsIntegrationCard } from "./settings-client"

export const dynamic = "force-dynamic"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const profile = await requireAdmin()
  const { tab } = await searchParams
  const canManageUsers = hasCmsPermission(profile, "users.manage")

  const [users, xero] = await Promise.all([
    canManageUsers ? listCmsStaffUsers() : Promise.resolve([]),
    getXeroConnectionStatus(),
  ])
  const wix = isWixConfigured()

  const integrations: SettingsIntegrationCard[] = [
    {
      href: "/admin/integrations/xero",
      title: "Xero",
      description: "Invoices are created in Xero when a deal is billed, then payment status comes back automatically.",
      status: xero.connected
        ? xero.tenantName
          ? `Connected · ${xero.tenantName}`
          : "Connected"
        : xero.configured
          ? "Ready to connect"
          : "Not configured",
      connected: xero.connected,
    },
    {
      href: "/admin/integrations/wix",
      title: "Wix",
      description: "Website stock, retail prices, and paid consumer orders on zk-sports.com.",
      status: wix ? "API keys configured" : "Not configured",
      connected: wix,
    },
  ]

  return (
    <SettingsClient
      currentUserId={profile.id}
      canManageUsers={canManageUsers}
      users={users}
      integrations={integrations}
      initialTab={tab === "integrations" || !canManageUsers ? "integrations" : "users"}
    />
  )
}
