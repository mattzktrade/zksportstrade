"use server"

import { revalidatePath } from "next/cache"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasCmsPermission, isCmsRole, type CmsRole } from "@/lib/auth/permissions"

type Result = { ok: true; message: string } | { ok: false; message: string }

async function usersGate(): Promise<
  | { profile: NonNullable<Awaited<ReturnType<typeof getPortalProfile>>>; admin: NonNullable<ReturnType<typeof createAdminClient>> }
  | { profile?: undefined; admin?: undefined; error: string }
> {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "users.manage")) {
    return { error: "Admin permission is required to manage users." }
  }
  const admin = createAdminClient()
  if (!admin) {
    return { error: "Supabase service role is not configured." }
  }
  return { profile, admin }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected settings error."
}

function cleanEmail(value: string): string {
  return value.trim().toLowerCase()
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters."
  return null
}

async function adminCount(admin: NonNullable<ReturnType<typeof createAdminClient>>): Promise<number> {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
  return count ?? 0
}

export async function createStaffUser(input: {
  fullName: string
  email: string
  password: string
  role: CmsRole
}): Promise<Result> {
  const gate = await usersGate()
  if ("error" in gate) return { ok: false, message: gate.error }

  const fullName = input.fullName.trim()
  const email = cleanEmail(input.email)
  if (!fullName) return { ok: false, message: "Enter a name." }
  if (!email || !email.includes("@")) return { ok: false, message: "Enter a valid email address." }
  if (!isCmsRole(input.role)) return { ok: false, message: "Choose Admin, Finance, or Sales." }
  const passwordError = validatePassword(input.password)
  if (passwordError) return { ok: false, message: passwordError }

  try {
    const { data, error } = await gate.admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        company_name: "ZK Sports & Entertainment",
      },
    })
    if (error || !data.user) throw new Error(error?.message ?? "Could not create the login.")

    const { error: profileError } = await gate.admin
      .from("profiles")
      .update({
        email,
        full_name: fullName,
        company_name: "ZK Sports & Entertainment",
        role: input.role,
        approval_status: "approved",
      })
      .eq("id", data.user.id)
    if (profileError) throw new Error(profileError.message)

    revalidatePath("/admin/settings")
    return {
      ok: true,
      message: `${fullName} can now sign in with ${email} and the password you set.`,
    }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function updateStaffRole(userId: string, role: CmsRole): Promise<Result> {
  const gate = await usersGate()
  if ("error" in gate) return { ok: false, message: gate.error }
  if (!isCmsRole(role)) return { ok: false, message: "Choose Admin, Finance, or Sales." }

  try {
    const { data: current, error: lookupError } = await gate.admin
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", userId)
      .maybeSingle()
    if (lookupError || !current) throw new Error(lookupError?.message ?? "User not found.")

    if (current.role === "admin" && role !== "admin") {
      if (current.id === gate.profile.id) {
        return { ok: false, message: "You cannot remove your own admin access." }
      }
      if ((await adminCount(gate.admin)) <= 1) {
        return { ok: false, message: "Keep at least one admin on the team." }
      }
    }

    const { error } = await gate.admin.from("profiles").update({ role }).eq("id", userId)
    if (error) throw new Error(error.message)

    revalidatePath("/admin/settings")
    return { ok: true, message: "Role updated." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function updateStaffPassword(userId: string, password: string): Promise<Result> {
  const gate = await usersGate()
  if ("error" in gate) return { ok: false, message: gate.error }
  const passwordError = validatePassword(password)
  if (passwordError) return { ok: false, message: passwordError }

  try {
    const { error } = await gate.admin.auth.admin.updateUserById(userId, { password })
    if (error) throw new Error(error.message)
    revalidatePath("/admin/settings")
    return { ok: true, message: "Password updated. They can sign in with the new password now." }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}

export async function deleteStaffUser(userId: string): Promise<Result> {
  const gate = await usersGate()
  if ("error" in gate) return { ok: false, message: gate.error }
  if (userId === gate.profile.id) {
    return { ok: false, message: "You cannot delete your own login." }
  }

  try {
    const { data: current, error: lookupError } = await gate.admin
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", userId)
      .maybeSingle()
    if (lookupError || !current) throw new Error(lookupError?.message ?? "User not found.")
    if (current.role === "admin" && (await adminCount(gate.admin)) <= 1) {
      return { ok: false, message: "Keep at least one admin on the team." }
    }

    const { error } = await gate.admin.auth.admin.deleteUser(userId)
    if (error) throw new Error(error.message)

    revalidatePath("/admin/settings")
    return { ok: true, message: `${current.full_name || "User"} has been removed.` }
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}
