import { createAdminClient } from "@/lib/supabase/admin"

const VALID_COMPANY_TYPES = new Set([
  "concierge",
  "travel_agency",
  "ticket_agent",
  "hospitality_agency",
  "other",
])

export type EnsureProfileResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string }

/**
 * Ensures a row in public.profiles exists for the given auth user.
 *
 * Normally the after-insert `handle_new_user` trigger covers this on first
 * signup. This helper is a safety net for edge cases where a profile is
 * missing but an auth.users row exists, e.g.:
 *
 *  - The profile row was manually deleted (cascade is auth.users -> profiles,
 *    not the other way around, so a stale auth.users can outlive its profile).
 *  - signUp returned a reused, still-unconfirmed account so the after-insert
 *    trigger never fired for the retry attempt.
 *
 * Mirrors the trigger's sanitisation rules for company_type so the data row
 * is identical to what the trigger would have produced.
 */
export async function ensureProfileForUser(user: {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}): Promise<EnsureProfileResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not configured" }
  }

  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()

  if (lookupError) {
    console.error("[ensure-profile] lookup:", lookupError.message)
    return { ok: false, error: lookupError.message }
  }
  if (existing) {
    return { ok: true, created: false }
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : ""
  const companyName = typeof meta.company_name === "string" ? meta.company_name.trim() : ""
  const rawCompanyType =
    typeof meta.company_type === "string" ? meta.company_type.trim() : ""
  const companyType = VALID_COMPANY_TYPES.has(rawCompanyType) ? rawCompanyType : null

  const { error: insertError } = await admin.from("profiles").insert({
    id: user.id,
    email: user.email ?? "",
    full_name: fullName,
    company_name: companyName,
    company_type: companyType,
    role: "agent",
    approval_status: "pending",
  })

  if (insertError) {
    // Race with the trigger / another concurrent call inserting the same id.
    // 23505 = unique_violation on the primary key — already created, treat as success.
    if (insertError.code === "23505") {
      return { ok: true, created: false }
    }
    console.error("[ensure-profile] insert:", insertError.message)
    return { ok: false, error: insertError.message }
  }

  return { ok: true, created: true }
}
