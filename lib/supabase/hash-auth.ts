/** Parse OAuth/session params from a URL hash fragment (client-only). */
export function parseHashAuthParams(hash: string): Record<string, string> {
  if (!hash || hash === "#") return {}
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash
  const params = new URLSearchParams(stripped)
  const out: Record<string, string> = {}
  params.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export function hasHashAuthTokens(hash: string): boolean {
  const p = parseHashAuthParams(hash)
  return Boolean(p.access_token && p.refresh_token)
}
