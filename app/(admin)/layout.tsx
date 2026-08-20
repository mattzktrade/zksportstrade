import { Toaster } from "sonner"
import { AdminLayout } from "@/components/admin-layout"
import { requireAdmin } from "@/lib/admin/require-admin"

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin()
  return (
    <AdminLayout profileName={profile.full_name?.trim() || profile.email}>
      {children}
      <Toaster richColors position="top-center" />
    </AdminLayout>
  )
}
