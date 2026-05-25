"use server"

import { headers } from "next/headers"
import { checkRateLimit } from "@/lib/auth/rate-limit"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { sendSignupConfirmationEmail } from "@/lib/email/send-signup-confirmation"

export type SendSignupConfirmationResult = { ok: true } | { ok: false; message: string }

/**
 * Sends a Resend-backed signup confirmation email to the given address.
 *
 * Safe to call:
 *  - Immediately after `supabase.auth.signUp` (adds a reliable second delivery
 *    when Supabase's built-in email service is rate-limited / spammed).
 *  - From a "Resend confirmation email" button on the post-signup screen.
 *
 * Always returns { ok: true } when delivery isn't configured (no service-role
 * key or Resend credentials), so the UI behaviour matches Supabase's default
 * "don't reveal account existence" semantics.
 */
export async function sendSignupConfirmation(email: string): Promise<SendSignupConfirmationResult> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: "Enter a valid email address." }
  }

  const h = await headers()
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"

  if (!checkRateLimit(`signup-confirm:ip:${ip}`, 8, 15 * 60 * 1000)) {
    return { ok: true }
  }
  if (!checkRateLimit(`signup-confirm:email:${trimmed}`, 5, 60 * 60 * 1000)) {
    return { ok: true }
  }

  const origin = getServerSiteOrigin()
  const redirectTo = `${origin}/auth/callback`

  const result = await sendSignupConfirmationEmail({
    email: trimmed,
    redirectTo,
    siteOrigin: origin,
  })

  if (result.ok) {
    return { ok: true }
  }

  if ("skipped" in result) {
    // No service-role key or Resend config — let Supabase's built-in email
    // path handle it. Silent success keeps the UI flow unchanged.
    console.warn("[signup-confirm] skipped:", result.skipped)
    return { ok: true }
  }

  return { ok: false, message: result.error }
}
