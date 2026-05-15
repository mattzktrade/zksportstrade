"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { buildPasswordResetRedirectUrl } from "@/lib/auth/password-reset-redirect"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset"

export type RequestPasswordResetResult = { ok: true } | { ok: false; message: string }

export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: "Enter a valid email address." }
  }

  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"

  if (!checkRateLimit(`pwreset:ip:${ip}`, 8, 15 * 60 * 1000)) {
    return { ok: true }
  }
  if (!checkRateLimit(`pwreset:email:${trimmed}`, 3, 60 * 60 * 1000)) {
    return { ok: true }
  }

  const origin = getServerSiteOrigin()
  const redirectTo = buildPasswordResetRedirectUrl(origin)

  const result = await sendPasswordResetEmail({
    email: trimmed,
    redirectTo,
    siteOrigin: origin,
  })

  if (result.ok) {
    return { ok: true }
  }

  if ("skipped" in result) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    if (!url || !anon) {
      return { ok: false, message: "Password reset is not configured on this server." }
    }
    const supabase = createClient(url, anon)
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo })
    if (error) {
      console.error("[password-reset] Supabase fallback:", error.message)
    }
    return { ok: true }
  }

  return { ok: false, message: result.error }
}
