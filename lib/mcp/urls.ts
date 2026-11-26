import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { toDisplayImageUrl } from "@/lib/images/display-image-url"

export function mcpAbsoluteUrl(pathOrUrl: string | null | undefined): string | null {
  const raw = pathOrUrl?.trim() ?? ""
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const origin = getServerSiteOrigin()
  if (raw.startsWith("/")) return `${origin}${raw}`
  return `${origin}/${raw}`
}

export function mcpMediaUrl(pathOrUrl: string | null | undefined): string | null {
  const display = toDisplayImageUrl(pathOrUrl)
  if (!display || display === "/placeholder.svg") {
    const raw = pathOrUrl?.trim() ?? ""
    return raw ? mcpAbsoluteUrl(raw) : null
  }
  return mcpAbsoluteUrl(display)
}

export function mcpEndpointUrl(): string {
  return `${getServerSiteOrigin()}/mcp`
}
