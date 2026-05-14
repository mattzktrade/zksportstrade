"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"
import { AuthCardBrand } from "@/components/auth-card-brand"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") ?? "/"
  const error = searchParams.get("error")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState<string | null>(null)

  const emailNotConfirmed =
    message != null &&
    (message.toLowerCase().includes("email not confirmed") ||
      message.toLowerCase().includes("email address not confirmed"))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    setResendSuccess(null)
    const supabase = createClient()
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signError) {
      setMessage(signError.message)
      return
    }
    router.push(redirect)
    router.refresh()
  }

  async function handleResendVerification() {
    const trimmed = email.trim()
    if (!trimmed) {
      setMessage("Enter your email above, then try resending the verification email.")
      return
    }
    setResendLoading(true)
    setResendSuccess(null)
    setMessage(null)
    const supabase = createClient()
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setResendLoading(false)
    if (resendError) {
      setMessage(resendError.message)
      return
    }
    setResendSuccess("We sent a new verification link. Check your inbox and spam folder.")
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      <AuthCardBrand />
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground mt-1">Use the email and password for your trade portal account.</p>
      </div>

      {error === "account_rejected" && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          Your access request was not approved. If you think this is a mistake, contact ZK Sports & Entertainment.
        </p>
      )}
      {error === "auth_callback" && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Sign-in link expired or was invalid. Please try again.
        </p>
      )}
      {error === "no_profile" && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Your account is missing profile data. Please contact support.
        </p>
      )}
      {resendSuccess && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{resendSuccess}</p>
      )}
      {message && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-2">
          <p>{message}</p>
          {emailNotConfirmed && (
            <div className="pt-1 border-t border-red-100">
              <button
                type="button"
                disabled={resendLoading}
                onClick={() => void handleResendVerification()}
                className="text-primary font-semibold hover:underline disabled:opacity-50 inline-flex items-center gap-2"
              >
                {resendLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden /> : null}
                Resend verification email
              </button>
              <p className="text-red-600/90 text-xs mt-1.5 font-normal">
                Uses the email in the field above. If it does not match your signup email, correct it first.
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Need access?{" "}
        <Link href="/signup" className="text-primary font-medium hover:underline">
          Request access
        </Link>
      </p>
    </div>
  )
}
