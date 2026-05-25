"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AuthCardBrand } from "@/components/auth-card-brand"
import { PasswordInput } from "@/components/password-input"
import { Loader2 } from "lucide-react"
import { useHashAuthRedirect } from "@/hooks/use-hash-auth-redirect"

export function ResetPasswordForm() {
  const router = useRouter()
  const handlingHash = useHashAuthRedirect("/reset-password")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    if (handlingHash) return
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user)
      setSessionChecked(true)
    })
  }, [handlingHash])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.")
      return
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.")
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setDone(true)
    router.refresh()
  }

  if (handlingHash || !sessionChecked) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-8 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {handlingHash ? "Opening password reset…" : "Loading…"}
        </p>
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
        <AuthCardBrand />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Link expired</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This password reset link is invalid or has expired. Request a new link from the sign-in page.
          </p>
        </div>
        <Link
          href="/login"
          className="block w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 text-center"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
        <AuthCardBrand />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Password updated</h1>
          <p className="text-sm text-muted-foreground mt-1">Your password has been updated. You can continue into the portal.</p>
        </div>
        <Link
          href="/"
          className="block w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 text-center"
        >
          Continue to portal
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      <AuthCardBrand />
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Set a new password</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose a new password for your trade portal account.</p>
      </div>

      {message && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{message}</p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
            New password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
            Confirm password
          </label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Update password
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary font-medium hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
