import { Suspense } from "react"
import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-card border border-border rounded-2xl p-8 flex justify-center">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}