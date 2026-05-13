import { AdminLayout } from "@/components/admin-layout"
import { requireAdmin } from "@/lib/admin/require-admin"

export default async function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <AdminLayout>{children}</AdminLayout>
}
