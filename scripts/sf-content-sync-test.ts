/**
 * Test Phase 3 content sync for one package.
 * Usage: npx tsx scripts/sf-content-sync-test.ts barcelona-f1-experiences-paddock-club-2026
 */
import { config } from "dotenv"
import { resolve } from "path"
import { buildCatalogListingPayload } from "../lib/catalog/listing-payload"
import { syncPackageToSalesforce } from "../lib/integrations/salesforce/products"
import { createAdminClient } from "../lib/supabase/admin"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

const packageId = process.argv[2]?.trim()
if (!packageId) {
  console.error("Usage: npx tsx scripts/sf-content-sync-test.ts <package-id>")
  process.exit(1)
}

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY required")

  const payload = await buildCatalogListingPayload(admin, packageId)
  console.log("Portal listing payload:")
  console.log("  imageUrl:", payload.imageUrl ?? "(none)")
  console.log("  galleryUrls:", payload.galleryUrls.length)
  console.log("  brochureUrl:", payload.brochureUrl ?? "(none)")
  console.log("  includes:", payload.includes.length)
  console.log("  description:", payload.description ? `${payload.description.slice(0, 60)}…` : "(none)")

  if (!payload.imageUrl && payload.galleryUrls.length === 0) {
    console.warn(
      "\nNo image URLs in payload — add hero/gallery images in Admin → Catalog, or set NEXT_PUBLIC_APP_URL for /images/ paths.",
    )
  }

  console.log("\nRunning sync…")
  const result = await syncPackageToSalesforce(packageId)
  console.log("\nfieldsUpdated:", result.fieldsUpdated.join(", ") || "(none)")
  console.log("fieldsSkipped:", result.fieldsSkipped.join("; ") || "(none)")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
