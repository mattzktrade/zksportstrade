import { buildCatalogListingPayload } from "@/lib/catalog/listing-payload"
import { wixRequest, WixApiError } from "@/lib/integrations/wix/client"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { WIX_DEFAULT_VARIANT_ID } from "@/lib/integrations/wix/constants"
import { syncWixProductContent } from "@/lib/integrations/wix/product-content"
import { createAdminClient } from "@/lib/supabase/admin"

export type WixChannelListing = {
  id: string
  package_id: string
  external_id: string
  external_variant_id: string | null
  page_url: string | null
  metadata: Record<string, unknown>
}

export type WixCatalogSyncResult = {
  ok: boolean
  updated: number
  skipped: string[]
  errors: string[]
}

async function getWixListings(packageId: string): Promise<WixChannelListing[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data, error } = await admin
    .from("channel_listings")
    .select("id, package_id, external_id, external_variant_id, page_url, metadata")
    .eq("package_id", packageId)
    .eq("channel", "wix")

  if (error || !data) return []
  return data as WixChannelListing[]
}

async function markListingSync(listingId: string, error: string | null): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from("channel_listings")
    .update({
      last_synced_at: error ? null : new Date().toISOString(),
      last_sync_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listingId)
}

/**
 * Update Wix Stores Catalog V1 product price + inventory for one mapping row.
 *
 * Price: PATCH /stores/v1/products/{id} with product.priceData
 * Stock: PATCH /stores/v2/inventoryItems/product/{productId}
 */
async function syncWixListingRow(input: {
  listing: WixChannelListing
  payload: Awaited<ReturnType<typeof buildCatalogListingPayload>>
  sellable: number
  retailUnitPrice: number | null
  currency: string
}): Promise<void> {
  const productId = input.listing.external_id.trim()
  if (!productId) throw new Error("Wix product id is missing on channel_listings row.")

  const variantId =
    input.listing.external_variant_id?.trim() || WIX_DEFAULT_VARIANT_ID

  await syncWixProductContent(productId, input.payload)

  if (input.retailUnitPrice != null) {
    const currency = input.currency.trim() || "USD"
    await wixRequest("PATCH", `/stores/v1/products/${encodeURIComponent(productId)}`, {
      body: {
        product: {
          priceData: {
            price: input.retailUnitPrice,
            currency,
          },
        },
      },
    })
  }

  const qty = Math.max(0, Math.floor(input.sellable))

  await wixRequest(
    "PATCH",
    `/stores/v2/inventoryItems/product/${encodeURIComponent(productId)}`,
    {
      body: {
        inventoryItem: {
          productId,
          trackQuantity: true,
          variants: [{ variantId, quantity: qty }],
        },
      },
    },
  )
}

/** Push sellable qty + retail price to mapped Wix product lines. */
export async function syncPackageCatalogToWix(packageId: string): Promise<WixCatalogSyncResult> {
  const skipped: string[] = []
  const errors: string[] = []
  let updated = 0

  if (!isWixConfigured()) {
    return { ok: false, updated: 0, skipped: ["Wix API not configured (WIX_API_KEY, WIX_SITE_ID)"], errors: [] }
  }

  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, updated: 0, skipped: ["Service role not configured"], errors: [] }
  }

  const { data: pkg } = await admin
    .from("packages")
    .select("sell_on_wix")
    .eq("id", packageId)
    .maybeSingle()

  if (!pkg?.sell_on_wix) {
    return { ok: true, updated: 0, skipped: ["sell_on_wix is false"], errors: [] }
  }

  const listings = await getWixListings(packageId)
  if (listings.length === 0) {
    return {
      ok: true,
      updated: 0,
      skipped: ["No Wix channel_listings rows — add mapping in Admin → Catalog → Wix listing"],
      errors: [],
    }
  }

  const payload = await buildCatalogListingPayload(admin, packageId)

  const { data: inv } = await admin
    .from("package_inventory")
    .select("qty_available, qty_held")
    .eq("package_id", packageId)
    .maybeSingle()

  const sellable = Math.max(0, (inv?.qty_available ?? 0) - (inv?.qty_held ?? 0))
  const retailUnit = payload.pricing.retailPrice

  for (const listing of listings) {
    try {
      await syncWixListingRow({
        listing,
        payload,
        sellable,
        retailUnitPrice: retailUnit,
        currency: payload.pricing.currency,
      })
      await markListingSync(listing.id, null)
      updated++
    } catch (e) {
      const msg =
        e instanceof WixApiError
          ? `${e.message} (${e.status})`
          : e instanceof Error
            ? e.message
            : String(e)
      errors.push(`${listing.external_id}: ${msg}`)
      await markListingSync(listing.id, msg)
    }
  }

  return { ok: errors.length === 0, updated, skipped, errors }
}
