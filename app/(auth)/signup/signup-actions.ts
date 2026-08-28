"use server"

import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { normalizeSignInEmail } from "@/lib/auth/sign-in-email"
import { validateSignupInput } from "@/lib/auth/signup"

export type SignupResult =
  | { ok: true; needsEmailConfirm: boolean }
  | { ok: false; message: string }

const TOO_MANY = "Too many requests. Wait a few minutes and try again."

export async function signUpAction(input: {
  fullName: string
  companyName: string
  companyType: string
  email: string
  password: string
}): Promise<SignupResult> {
  const parsed = validateSignupInput(input)
  if (!parsed.ok) return parsed

  const h = await headers()
  const ip = clientIpFromHeaders(h)
  if (!checkRateLimit(`signup:ip:${ip}`, 6, 15 * 60 * 1000)) {
    return { ok: false, message: TOO_MANY }
  }
  if (!checkRateLimit(`signup:email:${parsed.value.email}`, 3, 60 * 60 * 1000)) {
    return { ok: false, message: TOO_MANY }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.value.email,
    password: parsed.value.password,
    options: {
      emailRedirectTo: `${getServerSiteOrigin()}/auth/callback`,
      data: {
        full_name: parsed.value.fullName,
        company_name: parsed.value.companyName,
        company_type: parsed.value.companyType,
      },
    },
  })

  if (error) {
    return { ok: false, message: error.message }
  }

  return { ok: true, needsEmailConfirm: Boolean(data.user && !data.session) }
}

export async function resendSignupConfirmationAction(email: string): Promise<SignupResult> {
  const normalizedEmail = normalizeSignInEmail(email)
  if (!normalizedEmail) {
    return { ok: false, message: "Enter the same email you used to register." }
  }

  const h = await headers()
  const ip = clientIpFromHeaders(h)
  if (!checkRateLimit(`signup-resend:ip:${ip}`, 5, 15 * 60 * 1000)) {
    return { ok: false, message: TOO_MANY }
  }
  if (!checkRateLimit(`signup-resend:email:${normalizedEmail}`, 3, 60 * 60 * 1000)) {
    return { ok: false, message: TOO_MANY }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${getServerSiteOrigin()}/auth/callback`,
    },
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, needsEmailConfirm: true }
}
