import type { CatalogListingPayload } from "@/lib/catalog/listing-payload"
import {
  formatGalleryForSalesforce,
  formatIncludesForSalesforce,
} from "@/lib/catalog/listing-payload"
import type { SalesforceConfig } from "@/lib/integrations/salesforce/config"
import { salesforceRequest } from "@/lib/integrations/salesforce/client"
import { PROTECTED_SALESFORCE_PRODUCT_FIELDS } from "@/lib/integrations/salesforce/inventory-snapshot"
import { resolveProductContentFields } from "@/lib/integrations/salesforce/content-fields"

type SyncCtx = {
  updateable: Set<string>
  fieldsUpdated: string[]
  fieldsSkipped: string[]
}

async function patchProductField(
  product2Id: string,
  api: string,
  value: unknown,
  label: string,
  ctx: SyncCtx,
): Promise<void> {
  if (PROTECTED_SALESFORCE_PRODUCT_FIELDS.has(api)) {
    ctx.fieldsSkipped.push(`${label} (${api} is owned by Salesforce — not synced from portal)`)
    return
  }
  // Content fields (URL, long text) are often updateable via API even when describe says otherwise.
  try {
    await salesforceRequest("PATCH", `/sobjects/Product2/${product2Id}`, {
      body: { [api]: value },
    })
    ctx.fieldsUpdated.push(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ctx.fieldsSkipped.push(`${label}: ${msg}`)
  }
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

  if (payload.imageUrl) {
    if (contentFields.imageUrl) {
      await patchProductField(product2Id, contentFields.imageUrl, payload.imageUrl, "Image URL", ctx)
    } else {
      ctx.fieldsSkipped.push(
        "Image URL: no matching Product field (set SALESFORCE_FIELD_IMAGE_URL in .env.local).",
      )
    }
  }

  if (payload.galleryUrls.length > 0) {
    const galleryText = formatGalleryForSalesforce(payload.galleryUrls)
    if (contentFields.gallery) {
      await patchProductField(product2Id, contentFields.gallery, galleryText, "Image gallery", ctx)
    } else {
      ctx.fieldsSkipped.push(
        "Image gallery: no matching Product field (set SALESFORCE_FIELD_GALLERY in .env.local).",
      )
    }
  }

  if (payload.includes.length > 0) {
    const includesText = formatIncludesForSalesforce(payload.includes)
    if (contentFields.includes) {
      await patchProductField(product2Id, contentFields.includes, includesText, "Includes", ctx)
    } else {
      ctx.fieldsSkipped.push(
        "Includes: no matching Product field (set SALESFORCE_FIELD_INCLUDES in .env.local).",
      )
    }
  }

  if (payload.brochureUrl) {
    if (contentFields.brochureUrl) {
      await patchProductField(
        product2Id,
        contentFields.brochureUrl,
        payload.brochureUrl,
        "Brochure URL",
        ctx,
      )
    } else {
      ctx.fieldsSkipped.push(
        "Brochure URL: no matching Product field (set SALESFORCE_FIELD_BROCHURE_URL in .env.local).",
      )
    }
  }
}
