"use server"

import { createClient } from "@supabase/supabase-js"
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset"

export type RequestPasswordResetResult = { ok: true } | { ok: false; message: string }

export async function requestPasswordReset(
  email: string,
  siteOrigin: string,
): Promise<RequestPasswordResetResult> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: "Enter a valid email address." }
  }

  const origin = siteOrigin.replace(/\/$/, "")
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`

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
