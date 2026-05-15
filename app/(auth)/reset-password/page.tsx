import { Suspense } from "react"
import { ResetPasswordForm } from "./reset-password-form"

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-card border border-border rounded-2xl p-8 flex justify-center">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}
