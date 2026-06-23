/**
 * Print Wix Stores product + variant IDs for portal mapping.
 *
 * Usage:
 *   npx tsx scripts/wix-product-lookup.ts 451973a4-41c4-2215-260b-7ae81d52dfea
 *
 * Requires .env.local: WIX_API_KEY, WIX_SITE_ID (GUID, not website URL)
 */
import { config } from "dotenv"
import { resolve } from "path"
import { wixRequest } from "../lib/integrations/wix/client"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

const productId = process.argv[2]?.trim()
if (!productId) {
  console.error("Usage: npx tsx scripts/wix-product-lookup.ts <wix-product-id>")
  process.exit(1)
}

type WixProductResponse = {
  product?: {
    id?: string
    name?: string
    variants?: Array<{
      id?: string
      sku?: string
      priceData?: { price?: number; currency?: string }
      stock?: { quantity?: number }
    }>
  }
}

async function main() {
  const data = await wixRequest<WixProductResponse>(
    "GET",
    `/stores/v1/products/${encodeURIComponent(productId)}`,
  )
  const p = data.product
  if (!p) {
    console.error("No product returned. Check WIX_SITE_ID (must be the GUID from your dashboard URL) and product id.")
    process.exit(1)
  }

  console.log("Product:", p.name ?? "(no name)")
  console.log("Product ID:", p.id ?? productId)
  console.log("")
  const variants = p.variants ?? []
  if (variants.length === 0) {
    console.log("No variants on this product — add a default variant in Wix or check API permissions.")
    return
  }
  for (const v of variants) {
    console.log("— Variant ID:", v.id)
    console.log("  SKU:", v.sku ?? "—")
    console.log("  Price:", v.priceData?.price, v.priceData?.currency ?? "")
    console.log("  Stock:", v.stock?.quantity ?? "—")
    console.log("")
  }
  console.log("Paste Product ID + Variant ID into Admin → Catalog → Wix listing map.")
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(msg)
  if (msg.includes("Metasite") || msg.includes("UNAUTHORIZED") || msg.includes("403")) {
    console.error("")
    console.error("Wix rejected the API key. Regenerate at:")
    console.error("  https://manage.wix.com/account/api-keys")
    console.error("Enable Wix Stores permissions, copy the full token (shown once), update WIX_API_KEY in .env.local.")
    console.error("A valid key is usually much longer than 32 characters — not a short hex string.")
  }
  process.exit(1)
})
