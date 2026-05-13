"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AuthCardBrand } from "@/components/auth-card-brand"
import { Clock, LogOut, Mail } from "lucide-react"

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
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 sm:px-8 pt-8 pb-6 space-y-6">
        <AuthCardBrand />

        <div className="flex justify-center pt-2">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-primary/5">
            <Clock className="h-7 w-7 text-primary" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Awaiting approval</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Thanks for registering. Our team will review your request and enable access for{" "}
            <span className="font-medium text-foreground">{companyName || "your company"}</span> shortly.
          </p>
        </div>

        <dl className="rounded-xl border border-border bg-muted/25 px-4 py-3.5 text-sm space-y-2.5">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground shrink-0">Name</dt>
            <dd className="font-medium text-right">{fullName || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground shrink-0">Company</dt>
            <dd className="font-medium text-right">{companyName || "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 items-start">
            <dt className="text-muted-foreground shrink-0 pt-0.5">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email
              </span>
            </dt>
            <dd className="font-medium text-right break-all">{email}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          You will be able to browse packages and submit bookings once your account is approved. We will use the email above to notify you.
        </p>

        <button
          type="button"
          onClick={() => void signOut()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
