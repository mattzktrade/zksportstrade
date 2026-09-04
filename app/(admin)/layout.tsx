import { Toaster } from "sonner"
import { AdminLayout } from "@/components/admin-layout"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin()
  return (
    <AdminLayout
      profileName={profile.full_name?.trim() || profile.email}
      canManageSettings={hasCmsPermission(profile, "settings.manage")}
    >
      {children}
      <Toaster richColors position="top-center" />
    </AdminLayout>
  )
}
