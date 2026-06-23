import { buildCatalogListingPayload } from "@/lib/catalog/listing-payload"
import { WIX_DEFAULT_VARIANT_ID } from "@/lib/integrations/wix/constants"
import { syncPackageCatalogToWix } from "@/lib/integrations/wix/catalog-sync"
import { buildWixProductDescription, buildWixProductTitle } from "@/lib/integrations/wix/product-content"
import { wixRequest, WixApiError } from "@/lib/integrations/wix/client"
import { isWixConfigured } from "@/lib/integrations/wix/config"
import { createAdminClient } from "@/lib/supabase/admin"

export type CreateWixProductResult = {
  productId: string
  variantId: string
  productName: string
}

type WixCreateProductResponse = {
  product?: {
    id?: string
    name?: string
    variants?: Array<{ id?: string }>
  }
}

/**
 * Create a new Wix Stores (Catalog V1) product from portal listing data, then push full sync.
 */
export async function createWixProductForPackage(packageId: string): Promise<CreateWixProductResult> {
  if (!isWixConfigured()) {
    throw new Error("Wix API is not configured (WIX_API_KEY, WIX_SITE_ID).")
  }

  const admin = createAdminClient()
  if (!admin) throw new Error("Service role not configured.")

  const id = packageId.trim()
  const { data: pkg } = await admin.from("packages").select("sell_on_wix, is_enquiry").eq("id", id).maybeSingle()
  if (!pkg?.sell_on_wix) {
    throw new Error("Enable Wix website on this package before creating a Wix product.")
  }
  if (pkg.is_enquiry) {
    throw new Error("Enquiry-only packages cannot be listed on Wix Stores.")
  }

  const { count } = await admin
    .from("channel_listings")
    .select("id", { count: "exact", head: true })
    .eq("package_id", id)
    .eq("channel", "wix")

  if ((count ?? 0) > 0) {
    throw new Error("This package already has a Wix listing — remove it first or update the existing mapping.")
  }

  const payload = await buildCatalogListingPayload(admin, id)
  if (payload.pricing.isEnquiry || payload.pricing.retailPrice == null) {
    throw new Error("Package needs a trade price before creating a Wix product.")
  }

  const name = buildWixProductTitle(payload)
  const description = buildWixProductDescription(payload)
  const currency = payload.pricing.currency.trim() || "USD"
  const price = payload.pricing.retailPrice

  const body: Record<string, unknown> = {
    product: {
      name,
      productType: "physical",
      visible: true,
      description,
      priceData: {
        price,
        currency,
      },
      costAndProfitData: {
        itemCost: 0,
      },
    },
  }

  let created: WixCreateProductResponse
  try {
    created = (await wixRequest("POST", "/stores/v1/products", { body })) as WixCreateProductResponse
  } catch (e) {
    const msg = e instanceof WixApiError ? e.message : e instanceof Error ? e.message : String(e)
    throw new Error(`Wix product create failed: ${msg}`)
  }

  const productId = created.product?.id?.trim()
  if (!productId) {
    throw new Error("Wix did not return a product id.")
  }

  const variantId =
    created.product?.variants?.[0]?.id?.trim() || WIX_DEFAULT_VARIANT_ID

  const { error: mapErr } = await admin.from("channel_listings").insert({
    package_id: id,
    channel: "wix",
    external_id: productId,
    external_variant_id: variantId,
    page_url: null,
    metadata: { created_from_portal: true },
  })
  if (mapErr) {
    throw new Error(`Wix product created (${productId}) but portal mapping failed: ${mapErr.message}`)
  }

  const sync = await syncPackageCatalogToWix(id)
  if (!sync.ok || sync.errors.length > 0) {
    const detail = sync.errors.join(" · ") || sync.skipped.join(" ")
    throw new Error(
      `Wix product ${productId} created but sync failed: ${detail || "unknown error"}. Fix in Admin → Push listing to Wix.`,
    )
  }

  return { productId, variantId, productName: name }
}
