import { COMPANY_TYPES, type CompanyType } from "@/lib/types/profile"
import { normalizeSignInEmail } from "@/lib/auth/sign-in-email"

export type SignupFields = {
  fullName: string
  companyName: string
  companyType: CompanyType
  email: string
  password: string
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
  if (!companyName) return { ok: false, message: "Enter your company name." }
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
