"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { mapSignInError } from "@/lib/auth/sign-in-errors"
import { normalizeSignInEmail } from "@/lib/auth/sign-in-email"

export type SignInResult = { ok: true } | { ok: false; message: string }

export async function signInWithPasswordAction(
  email: string,
  password: string,
): Promise<SignInResult> {
  const normalizedEmail = normalizeSignInEmail(email)
  if (!normalizedEmail || !password) {
    return { ok: false, message: "Email and password are required." }
  }

  const h = await headers()
  const ip = clientIpFromHeaders(h)
  if (
    !checkRateLimit(`signin:ip:${ip}`, 12, 15 * 60 * 1000) ||
    !checkRateLimit(`signin:email:${normalizedEmail}`, 8, 15 * 60 * 1000)
  ) {
    return { ok: false, message: mapSignInError("too many requests") }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })

  if (error) {
    return { ok: false, message: mapSignInError(error.message) }
  }

  revalidatePath("/", "layout")
  return { ok: true }
}
