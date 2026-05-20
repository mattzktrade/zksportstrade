"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AuthCardBrand } from "@/components/auth-card-brand"
import { COMPANY_TYPE_OPTIONS, type CompanyType } from "@/lib/types/profile"
import { Loader2 } from "lucide-react"

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [companyType, setCompanyType] = useState<CompanyType | "">("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
        data: {
          full_name: fullName.trim(),
          company_name: companyName.trim(),
          company_type: companyType,
        },
      },
    })
    setLoading(false)
    if (error) {
      setMessage(error.message)
      return
    }
    if (data.user && !data.session) {
      setCheckEmail(true)
      return
    }
    router.push("/pending-approval")
    router.refresh()
  }

  if (checkEmail) {
    return (
      <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-5 text-center">
        <AuthCardBrand />
        <h1 className="text-xl font-bold text-foreground">Confirm your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to activate your account, then sign in.
        </p>
        <Link href="/login" className="inline-block text-sm text-primary font-medium hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      <AuthCardBrand />
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Request trade access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One login per company. After you register, our team will review and approve your account before you can view packages and book.
        </p>
      </div>

      {message && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{message}</p>}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-foreground mb-1.5">
            Your name
          </label>
          <input
            id="fullName"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label htmlFor="company" className="block text-sm font-medium text-foreground mb-1.5">
            Company name
          </label>
          <input
            id="company"
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label htmlFor="companyType" className="block text-sm font-medium text-foreground mb-1.5">
            Company type
          </label>
          <select
            id="companyType"
            required
            value={companyType}
            onChange={(e) => setCompanyType(e.target.value as CompanyType)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="" disabled>
              Select company type
            </option>
            {COMPANY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
            Work email
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit request
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
