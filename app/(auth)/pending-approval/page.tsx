import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { PendingApprovalClient } from "./pending-approval-client"

export default async function PendingApprovalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase.from("profiles").select("full_name, company_name, approval_status").eq("id", user.id).single()

  if (profile?.approval_status === "approved") {
    redirect("/")
  }
  if (profile?.approval_status === "rejected") {
    redirect("/login?error=account_rejected")
  }

  return (
    <PendingApprovalClient
      email={user.email ?? ""}
      fullName={profile?.full_name ?? ""}
      companyName={profile?.company_name ?? ""}
    />
  )
}
