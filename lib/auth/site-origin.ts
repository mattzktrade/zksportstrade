/** Canonical site origin for auth emails and redirects (never trust client `window.location.origin`). */
export function getServerSiteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/$/, "")
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) {
    const host = vercel.replace(/\/$/, "")
    return host.startsWith("http") ? host : `https://${host}`
  }

  return "http://localhost:3000"
}
