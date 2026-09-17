import { brochurePhotoUrls } from "@/lib/brochures/content"
import type { BrochureContent, BrochureCreateErrorCode } from "@/lib/brochures/types"

export const MIN_BROCHURE_PHOTOS = 3
export const MIN_BROCHURE_INCLUDES = 4
export const MIN_BROCHURE_DESCRIPTION = 70

export type BrochureReadiness =
  | { ok: true }
  | { ok: false; code: BrochureCreateErrorCode; message: string }

export function brochurePhotoCount(
  content: Pick<BrochureContent, "heroUrl" | "galleryUrls" | "trackMapUrl">,
): number {
  return brochurePhotoUrls(content.heroUrl, content.galleryUrls, content.trackMapUrl ?? null).length
}

export function assessBrochureReadiness(content: BrochureContent): BrochureReadiness {
  const photos = brochurePhotoCount(content)
  if (photos < MIN_BROCHURE_PHOTOS) {
    return {
      ok: false,
      code: "insufficient_images",
      message: `Add at least ${MIN_BROCHURE_PHOTOS} unique photos on this product (primary image plus gallery) before creating a brochure. The design is photography-led and will not invent images.`,
    }
  }

  const description = content.description?.trim() ?? ""
  const includes = content.includes.filter((item) => item.trim())
  const hasDescription = description.length >= MIN_BROCHURE_DESCRIPTION
  const hasIncludes = includes.length >= MIN_BROCHURE_INCLUDES

  if (hasDescription && hasIncludes) return { ok: true }

  const missing: string[] = []
  if (!hasDescription) {
    missing.push("a short description (a couple of accurate sentences is enough)")
  }
  if (!hasIncludes) {
    missing.push(`at least ${MIN_BROCHURE_INCLUDES} inclusions`)
  }

  return {
    ok: false,
    code: "insufficient_content",
    message: `This product needs ${missing.join(" and ")} before we can make a brochure. We only auto-fill copy for standard F1 Paddock Club or Champions Club programmes when the product name matches - we will not invent itineraries, prices, or inclusions.`,
  }
}
