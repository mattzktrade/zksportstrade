"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Clock, LogOut } from "lucide-react"

export function PendingApprovalClient({
  email,
  fullName,
  companyName,
}: {
  email: string
  fullName: string
  companyName: string
}) {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex justify-center">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Clock className="h-7 w-7 text-primary" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Awaiting approval</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Thanks for registering. Our team will review your request and enable access for <span className="font-medium text-foreground">{companyName || email}</span> shortly.
        </p>
      </div>
      <dl className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm space-y-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium text-right">{fullName || "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Company</dt>
          <dd className="font-medium text-right">{companyName || "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium text-right truncate max-w-[200px]">{email}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground text-center">
        You will be able to browse packages and submit bookings once your account is approved.
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )
}
