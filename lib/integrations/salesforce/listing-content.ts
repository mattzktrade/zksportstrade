import type { CatalogListingPayload } from "@/lib/catalog/listing-payload"
import {
  formatGalleryForSalesforce,
  formatIncludesForSalesforce,
} from "@/lib/catalog/listing-payload"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceRequest } from "@/lib/integrations/salesforce/client"
import { resolveProductContentFields } from "@/lib/integrations/salesforce/content-fields"

type SyncCtx = {
  fieldsUpdated: string[]
  fieldsSkipped: string[]
}

/**
 * Push portal listing content (images, includes, brochure) to Product2.
 * Best-effort: missing SF fields are skipped, never fails the whole product sync.
 */
export async function applyListingContentToProduct2(
  product2Id: string,
  payload: CatalogListingPayload,
  config: SalesforceConfig,
  ctx: SyncCtx,
): Promise<void> {
  const contentFields = await resolveProductContentFields(config)

  const body: Record<string, unknown> = {}
  const labels: string[] = []

  if (payload.imageUrl) {
    if (contentFields.imageUrl) {
      body[contentFields.imageUrl] = payload.imageUrl
      labels.push("Image URL")
    } else {
      ctx.fieldsSkipped.push(
        "Image URL: no matching Product field (set SALESFORCE_FIELD_IMAGE_URL in .env.local).",
      )
    }
  }

  if (payload.galleryUrls.length > 0) {
    const galleryText = formatGalleryForSalesforce(payload.galleryUrls)
    if (contentFields.gallery) {
      body[contentFields.gallery] = galleryText
      labels.push("Image gallery")
    } else {
      ctx.fieldsSkipped.push(
        "Image gallery: no matching Product field (set SALESFORCE_FIELD_GALLERY in .env.local).",
      )
    }
  }

  if (payload.includes.length > 0) {
    const includesText = formatIncludesForSalesforce(payload.includes)
    if (contentFields.includes) {
      body[contentFields.includes] = includesText
      labels.push("Includes")
    } else {
      ctx.fieldsSkipped.push(
        "Includes: no matching Product field (set SALESFORCE_FIELD_INCLUDES in .env.local).",
      )
    }
  }

  if (payload.brochureUrl) {
    if (contentFields.brochureUrl) {
      body[contentFields.brochureUrl] = payload.brochureUrl
      labels.push("Brochure URL")
    } else {
      ctx.fieldsSkipped.push(
        "Brochure URL: no matching Product field (set SALESFORCE_FIELD_BROCHURE_URL in .env.local).",
      )
    }
  }

  if (Object.keys(body).length === 0) return

  try {
    await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, { body })
    for (const api of Object.keys(body)) ctx.fieldsUpdated.push(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const label of labels) ctx.fieldsSkipped.push(`${label}: ${msg}`)
  }
}
