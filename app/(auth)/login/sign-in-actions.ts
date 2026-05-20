"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
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
