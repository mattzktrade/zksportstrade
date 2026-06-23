const WIX_MEDIA_BASE =
  /^https:\/\/static\.wixstatic\.com\/media\/([^/]+~mv2\.\w+)(?:\/v1\/[^?#]*)?(?:\?.*)?$/i

const WIX_FILL_WIDTH = /\/v1\/fill\/w_(\d+),/i

/** WordPress-style `-300x200` before the extension. */
const WP_SIZE_SUFFIX = /-(\d+)x(\d+)(?=\.(jpe?g|png|webp|gif|avif)$)/i

/** Shopify CDN `_300x300` before the extension. */
const SHOPIFY_SIZE_SUFFIX = /_(\d+)x(\d+)?(?=\.(jpe?g|png|webp|gif)$)/i

export type CatalogImageVariant = "thumb" | "card" | "hero"

const VARIANT_MAX_WIDTH: Record<CatalogImageVariant, number> = {
  thumb: 640,
  card: 1280,
  hero: 1920,
}

/**
 * Returns a display URL suitable for cover images: sharp on retina, but not multi‑MB originals.
 * Wix URLs use the CDN `fill` transform at a capped width; other hosts get query-size bumps only.
 */
export function toDisplayImageUrl(
  url: string | null | undefined,
  options?: { variant?: CatalogImageVariant },
): string {
  if (!url?.trim()) return "/placeholder.svg"
  const trimmed = url.trim()
  if (trimmed.startsWith("/")) return trimmed

  const variant = options?.variant ?? "card"
  const maxWidth = VARIANT_MAX_WIDTH[variant]
  let out = trimmed

  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname === "static.wixstatic.com") {
      out = upgradeWixStaticUrl(trimmed, maxWidth)
    } else {
      out = upgradeWordPressSizedUrl(trimmed)
      out = upgradeShopifySizedUrl(out)
      out = upgradeQuerySizedUrl(out, maxWidth)
    }
  } catch {
    return trimmed
  }

  return out
}

/** Stored catalog URLs — strip Wix transforms to stable base media paths; display adds sizing. */
export function normalizeCatalogImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const trimmed = url.trim()
  if (trimmed.startsWith("/")) return trimmed

  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname === "static.wixstatic.com") {
      const match = trimmed.match(WIX_MEDIA_BASE)
      if (match) return `https://static.wixstatic.com/media/${match[1]}`
    }
  } catch {
    return trimmed
  }

  return trimmed
}

export function normalizeCatalogImageUrlList(urls: string[]): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const normalized = normalizeCatalogImageUrl(raw)
    if (normalized) out.push(normalized)
  }
  return out
}

function upgradeWixStaticUrl(url: string, maxWidth: number): string {
  const match = url.match(WIX_MEDIA_BASE)
  if (!match) return url
  const file = match[1]
  const existing = parseWixFillWidth(url)
  const width = pickWixWidth(existing, maxWidth)
  return buildWixFillUrl(file, width)
}

function parseWixFillWidth(url: string): number | null {
  const m = url.match(WIX_FILL_WIDTH)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Thumbnails → target width; already-large → cap to avoid huge downloads. */
function pickWixWidth(existing: number | null, maxWidth: number): number {
  if (existing == null) return maxWidth
  if (existing < 600) return maxWidth
  if (existing > maxWidth * 1.15) return maxWidth
  return Math.min(existing, maxWidth)
}

function buildWixFillUrl(file: string, width: number): string {
  const height = Math.max(1, Math.round(width * 0.66))
  return `https://static.wixstatic.com/media/${file}/v1/fill/w_${width},h_${height},al_c,q_85,usm_0.66_1.00_0.01,enc_auto/${file}`
}

function upgradeWordPressSizedUrl(url: string): string {
  return url.replace(WP_SIZE_SUFFIX, "")
}

function upgradeShopifySizedUrl(url: string): string {
  return url.replace(SHOPIFY_SIZE_SUFFIX, "")
}

function upgradeQuerySizedUrl(url: string, minWidth: number): string {
  try {
    const parsed = new URL(url)
    let changed = false
    for (const key of ["w", "width", "resize", "fit_width"]) {
      const val = parsed.searchParams.get(key)
      if (val && /^\d+$/.test(val) && Number(val) < minWidth) {
        parsed.searchParams.set(key, String(minWidth))
        changed = true
      }
    }
    if (changed) return parsed.toString()
  } catch {
    /* keep original */
  }
  return url
}
