"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { requestPasswordReset } from "./actions"
import { signInWithPasswordAction } from "./sign-in-actions"
import { Loader2 } from "lucide-react"
import { AuthCardBrand } from "@/components/auth-card-brand"
import { PasswordInput } from "@/components/password-input"
import { safeRedirectPath } from "@/lib/auth/safe-redirect"
import { normalizeSignInEmail } from "@/lib/auth/sign-in-email"
import { useHashAuthRedirect } from "@/hooks/use-hash-auth-redirect"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = safeRedirectPath(searchParams.get("redirect"))
  const error = searchParams.get("error")
  const handlingHash = useHashAuthRedirect(redirect)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [mode, setMode] = useState<"signin" | "forgot">("signin")
  const [message, setMessage] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  const emailNotConfirmed =
    message != null &&
    (message.toLowerCase().includes("email not confirmed") ||
      message.toLowerCase().includes("email address not confirmed"))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    setResendSuccess(null)
    const result = await signInWithPasswordAction(email, password)
    setLoading(false)
    if (!result.ok) {
      setMessage(result.message)
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

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setMessage("Enter your email address and we will send you a reset link.")
      return
    }
    setResetLoading(true)
    setMessage(null)
    setResetSuccess(null)
    setResendSuccess(null)
    const result = await requestPasswordReset(trimmed)
    setResetLoading(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setResetSuccess(
      "If an account exists for that email, we sent a password reset link. Check your inbox and spam folder — the link expires after a short time.",
    )
  }

  function switchMode(next: "signin" | "forgot") {
    setMode(next)
    setMessage(null)
    setResendSuccess(null)
    setResetSuccess(null)
  }

  if (handlingHash) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Opening password reset…</p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      <AuthCardBrand />
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">
          {mode === "signin" ? "Sign in" : "Reset password"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "signin"
            ? "Use the email and password for your trade portal account."
            : "Enter your account email and we will send you a link to choose a new password."}
        </p>
      </div>

      {error === "account_rejected" && (
        <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
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
      {resetSuccess && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{resetSuccess}</p>
      )}
      {message && (
        <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2 space-y-2">
          <p>{message}</p>
          {emailNotConfirmed && (
            <div className="pt-1 border-t border-destructive/20">
              <button
                type="button"
                disabled={resendLoading}
                onClick={() => void handleResendVerification()}
                className="text-primary font-semibold hover:underline disabled:opacity-50 inline-flex items-center gap-2"
              >
                {resendLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden /> : null}
                Resend verification email
              </button>
              <p className="text-destructive/90 text-xs mt-1.5 font-normal">
                Uses the email in the field above. If it does not match your signup email, correct it first.
              </p>
            </div>
          )}
        </div>
      )}

      {mode === "signin" ? (
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
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-xs sm:text-sm text-primary font-medium hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id="password"
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
      ) : (
        <form onSubmit={(e) => void handleForgotPassword(e)} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-foreground mb-1.5">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            type="submit"
            disabled={resetLoading}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send reset link
          </button>
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="w-full py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            Back to sign in
          </button>
        </form>
      )}

      {mode === "signin" && (
        <p className="text-center text-sm text-muted-foreground">
          Need access?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            Request access
          </Link>
        </p>
      )}
    </div>
  )
}
