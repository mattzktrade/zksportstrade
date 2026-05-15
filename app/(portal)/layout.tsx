import { redirect } from "next/navigation"
import { Toaster } from "sonner"
import { PortalUserProvider } from "@/components/portal-user-provider"
import { PortalLayout } from "@/components/portal-layout"
import { getPortalProfile } from "@/lib/supabase/profile"

export default async function PortalGroupLayout({ children }: { children: React.ReactNode }) {
  const profile = await getPortalProfile()
  if (!profile) {
    redirect("/login")
  }
  if (profile.approval_status === "pending") {
    redirect("/pending-approval")
  }
  if (profile.approval_status === "rejected") {
    redirect("/login?error=account_rejected")
  }

  return (
    <PortalUserProvider profile={profile}>
      <PortalLayout>{children}</PortalLayout>
      <Toaster richColors position="top-center" />
    </PortalUserProvider>
  )
}
