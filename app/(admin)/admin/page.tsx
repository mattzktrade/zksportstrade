import { Suspense } from "react"
import { requireAdmin } from "@/lib/admin/require-admin"
import { isOperationsDashboardUser, isSalesDashboardUser } from "@/lib/admin/dashboard-audience"
import { AdminRoleDashboard } from "@/components/admin/admin-role-dashboard"
import { OperationsRoleDashboard } from "@/components/admin/operations-role-dashboard"
import { SalesRoleDashboard } from "@/components/admin/sales-role-dashboard"
import { StaffDashboard } from "@/components/admin/staff-dashboard"

export const dynamic = "force-dynamic"

function AdminDashboardFallback() {
  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-4 lg:p-5 animate-pulse">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="h-64 rounded-xl bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    </div>
  )
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<AdminDashboardFallback />}>
      <DashboardHome />
    </Suspense>
  )
}

async function DashboardHome() {
  const profile = await requireAdmin()
  if (isOperationsDashboardUser(profile)) {
    return <OperationsRoleDashboard />
  }
  if (profile.role === "admin") {
    return <AdminRoleDashboard />
  }
  if (isSalesDashboardUser(profile)) {
    return <SalesRoleDashboard />
  }
  return <StaffDashboard />
}
