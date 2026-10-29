import { COMPANY_TYPES, type CompanyType } from "@/lib/types/profile"
import { normalizeSignInEmail } from "@/lib/auth/sign-in-email"

export type SignupFields = {
  fullName: string
  companyName: string
  companyType: CompanyType
  email: string
  password: string
}

const MAX_SIGNUP_TEXT_LENGTH = 200

/** User-friendly copy for Supabase signUp / resend failures. */
export function mapSignupError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "We are receiving a lot of registrations right now. Wait a few minutes and try again."
  }
  return message
}

export function validateSignupInput(input: {
  fullName: string
  companyName: string
  companyType: string
  email: string
  password: string
}): { ok: true; value: SignupFields } | { ok: false; message: string } {
  const fullName = input.fullName.trim()
  const companyName = input.companyName.trim()
  const companyType = input.companyType.trim()
  const email = normalizeSignInEmail(input.email)
  const password = input.password

  if (!fullName) return { ok: false, message: "Enter your name." }
  if (fullName.length > MAX_SIGNUP_TEXT_LENGTH) return { ok: false, message: "Name is too long." }
  if (!companyName) return { ok: false, message: "Enter your company name." }
  if (companyName.length > MAX_SIGNUP_TEXT_LENGTH) return { ok: false, message: "Company name is too long." }
  if (!COMPANY_TYPES.includes(companyType as CompanyType)) {
    return { ok: false, message: "Select a company type." }
  }
  if (!email) return { ok: false, message: "Enter a valid work email." }
  if (!password || password.length < 8) {
    return { ok: false, message: "Password must be at least 8 characters." }
  }

  return {
    ok: true,
    value: {
      fullName,
      companyName,
      companyType: companyType as CompanyType,
      email,
      password,
    },
  }
}
