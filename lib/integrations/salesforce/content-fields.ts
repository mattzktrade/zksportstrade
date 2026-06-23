import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { getProduct2Fields, type SfFieldDescribe } from "@/lib/integrations/salesforce/describe"

export type ProductContentFieldMap = {
  imageUrl: string | null
  gallery: string | null
  includes: string | null
  brochureUrl: string | null
}

type CacheEntry = { at: number; map: ProductContentFieldMap }
let cached: CacheEntry | null = null
const CACHE_MS = 5 * 60 * 1000

function pickField(
  fields: SfFieldDescribe[],
  explicit: string | null | undefined,
  matcher: (f: SfFieldDescribe) => boolean,
): string | null {
  if (explicit?.trim()) {
    const name = explicit.trim()
    const hit = fields.find((f) => f.name === name)
    // Always prefer configured API names (ZK defaults / .env) over auto-detect.
    if (!hit || !hit.calculated) return name
  }
  const candidate = fields.find((f) => f.updateable && !f.calculated && matcher(f))
  return candidate?.name ?? null
}

function textish(f: SfFieldDescribe): boolean {
  return (
    f.type === "string" ||
    f.type === "textarea" ||
    f.type === "url" ||
    f.type === "encryptedstring"
  )
}

/**
 * Resolve Product2 fields for portal listing content (image, gallery, includes, brochure).
 * Env overrides win; otherwise auto-detect by API name / label.
 */
export async function resolveProductContentFields(
  config: SalesforceConfig,
): Promise<ProductContentFieldMap> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.map
  }

  const fields = await getProduct2Fields()

  const map: ProductContentFieldMap = {
    imageUrl: pickField(fields, config.fieldImageUrl, (f) => {
      if (f.type !== "url" && !textish(f)) return false
      return /image|photo|picture|hero|thumbnail/i.test(`${f.name} ${f.label}`)
    }),
    gallery: pickField(fields, config.fieldGallery, (f) => {
      if (f.type !== "textarea" && !textish(f)) return false
      return /gallery|images|image_?gallery/i.test(`${f.name} ${f.label}`)
    }),
    includes: pickField(fields, config.fieldIncludes, (f) => {
      if (f.type !== "textarea" && !textish(f)) return false
      return /include|what.*included|package.*detail|inclusions/i.test(`${f.name} ${f.label}`)
    }),
    brochureUrl: pickField(fields, config.fieldBrochureUrl, (f) => {
      if (f.type !== "url" && !textish(f)) return false
      return /brochure|pdf/i.test(`${f.name} ${f.label}`)
    }),
  }

  cached = { at: Date.now(), map }
  return map
}
