/**
 * Hosts `next/image` has always optimized in this app.
 * Extra hosts may be listed in next.config.mjs; unknown remotes use a native img
 * so hover-prefetch and galleries never crash on an unconfigured hostname.
 */
const OPTIMIZER_PATTERNS: Array<{ hostname: string; pathname: string }> = [
  { hostname: "static.wixstatic.com", pathname: "/media/**" },
  { hostname: "assets.quintevents.com", pathname: "/**" },
  { hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
]

function hostnameMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === pattern
}

function pathnameMatches(pattern: string, pathname: string): boolean {
  if (pattern === "/**") return true
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3)
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }
  return pathname === pattern
}

/** True when `next/image` will accept this src without throwing. */
export function canOptimizeCatalogImage(src: string): boolean {
  if (!src || src === "/placeholder.svg") return true
  if (src.startsWith("/") && !src.startsWith("//")) return true

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false

  return OPTIMIZER_PATTERNS.some(
    (pattern) => hostnameMatches(pattern.hostname, url.hostname) && pathnameMatches(pattern.pathname, url.pathname),
  )
}
