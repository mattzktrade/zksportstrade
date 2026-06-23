import type { CatalogListingPayload } from "@/lib/catalog/listing-payload"
import { formatIncludesForSalesforce } from "@/lib/catalog/listing-payload"
import { adminCatalogProductTitle } from "@/lib/admin/catalog-product-title"
import { wixRequest } from "@/lib/integrations/wix/client"

const WIX_NAME_MAX = 80
const WIX_DESCRIPTION_MAX = 8000
/** Blank line between description blocks in Wix rich text. */
const WIX_DESCRIPTION_SECTION_SEP = "<p><br /></p>"

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function formatPlainTextAsHtml(text: string): string {
  const escaped = escapeHtml(text)
  const withBreaks = escaped.replace(/\r?\n/g, "<br />")
  return `<p>${withBreaks}</p>`
}

/** Match portal catalog title, e.g. "Australian Grand Prix 2026 - Wix Test". */
export function buildWixProductTitle(payload: CatalogListingPayload): string {
  const raceName = payload.event.raceName ?? payload.event.circuit ?? "Event"
  return adminCatalogProductTitle({
    raceName,
    seasonYear: payload.event.season,
    packageName: payload.name,
    duration: payload.duration,
  }).slice(0, WIX_NAME_MAX)
}

/** Wix Stores accepts rich text HTML (max 8000 chars). */
export function buildWixProductDescription(payload: CatalogListingPayload): string {
  const blocks: string[] = []
  if (payload.description?.trim()) {
    blocks.push(formatPlainTextAsHtml(payload.description.trim()))
  }
  if (payload.includes.length > 0) {
    blocks.push(
      `<p><strong>What&rsquo;s included</strong></p>${formatIncludesForSalesforce(payload.includes)}`,
    )
  }
  if (payload.brochureUrl) {
    blocks.push(
      `<p><a href="${escapeHtml(payload.brochureUrl)}" target="_blank" rel="noopener noreferrer">Download brochure (PDF)</a></p>`,
    )
  }
  return blocks.join(WIX_DESCRIPTION_SECTION_SEP).slice(0, WIX_DESCRIPTION_MAX)
}

function normalizeMediaUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

type WixProductMedia = {
  product?: {
    media?: {
      items?: Array<{ image?: { url?: string } }>
    }
  }
}

/** Add hero + gallery images when not already on the Wix product. */
async function syncWixProductMedia(productId: string, payload: CatalogListingPayload): Promise<void> {
  const desired = [payload.imageUrl, ...payload.galleryUrls].filter((u): u is string => Boolean(u?.trim()))
  if (desired.length === 0) return

  const current = (await wixRequest("GET", `/stores/v1/products/${encodeURIComponent(productId)}`)) as WixProductMedia
  const existing = new Set(
    (current.product?.media?.items ?? [])
      .map((item) => item.image?.url)
      .filter((u): u is string => Boolean(u))
      .map(normalizeMediaUrl),
  )

  const toAdd = desired.filter((url) => !existing.has(normalizeMediaUrl(url)))
  if (toAdd.length === 0) return

  await wixRequest("POST", `/stores/v1/products/${encodeURIComponent(productId)}/media`, {
    body: {
      media: toAdd.slice(0, 50).map((url) => ({ url })),
    },
  })
}

/** Push portal listing copy + images to a mapped Wix Stores product (Catalog V1). */
export async function syncWixProductContent(
  productId: string,
  payload: CatalogListingPayload,
): Promise<void> {
  const name = buildWixProductTitle(payload)
  const description = buildWixProductDescription(payload)

  await wixRequest("PATCH", `/stores/v1/products/${encodeURIComponent(productId)}`, {
    body: {
      product: {
        name,
        description,
        sku: "",
        additionalInfoSections: [],
      },
    },
  })

  await syncWixProductMedia(productId, payload)
}
