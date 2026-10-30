import { Toaster } from "sonner"
import { AdminLayout } from "@/components/admin-layout"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { canUseRoadmap } from "@/lib/admin/personal-space"

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin()
  return (
    <AdminLayout
      profileName={profile.full_name?.trim() || profile.email}
      profileEmail={profile.email}
      canManageSettings={hasCmsPermission(profile, "settings.manage")}
      showRoadmap={canUseRoadmap(profile)}
    >
      {children}
      <Toaster richColors position="top-center" />
    </AdminLayout>
  )
}
