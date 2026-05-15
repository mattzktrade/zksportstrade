/** Client route that receives Supabase hash tokens (#access_token) — must not server-redirect away. */
export function buildPasswordResetRedirectUrl(siteOrigin: string): string {
  const origin = siteOrigin.replace(/\/$/, "")
  const next = encodeURIComponent("/reset-password")
  return `${origin}/auth/complete?next=${next}`
}
