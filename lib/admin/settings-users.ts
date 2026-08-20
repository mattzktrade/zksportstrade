import { createAdminClient } from "@/lib/supabase/admin"
import { isCmsRole, type CmsRole } from "@/lib/auth/permissions"

export type SettingsStaffUser = {
  id: string
  email: string
  fullName: string
  role: CmsRole
  createdAt: string | null
  lastSignInAt: string | null
}

export async function listCmsStaffUsers(): Promise<SettingsStaffUser[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .in("role", ["admin", "finance", "sales"])
    .order("full_name", { ascending: true })
  if (error || !profiles) return []

  const signInById = new Map<string, string | null>()
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const user of data.users) {
      signInById.set(user.id, user.last_sign_in_at ?? null)
    }
  } catch {
    // Auth lookup is optional — the table still works without last-sign-in.
  }

  return profiles.flatMap((row) => {
    if (!isCmsRole(row.role)) return []
    return [
      {
        id: String(row.id),
        email: String(row.email ?? ""),
        fullName: String(row.full_name ?? "").trim() || String(row.email ?? ""),
        role: row.role,
        createdAt: row.created_at ? String(row.created_at) : null,
        lastSignInAt: signInById.get(String(row.id)) ?? null,
      },
    ]
  })
}
