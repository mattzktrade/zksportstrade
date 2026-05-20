/** Normalize email for Supabase Auth (matches password-reset flow). */
export function normalizeSignInEmail(email: string): string {
  return email.trim().toLowerCase()
}
