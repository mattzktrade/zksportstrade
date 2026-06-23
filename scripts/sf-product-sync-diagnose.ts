/**
 * Diagnose Salesforce product sync: field updateability, product lookup, optional live sync.
 *
 * Usage:
 *   npx tsx scripts/sf-product-sync-diagnose.ts
 *   npx tsx scripts/sf-product-sync-diagnose.ts --sync monaco-paddock-club-house-44-2026
 *
 * Requires .env.local: Salesforce OAuth + SUPABASE_SERVICE_ROLE_KEY (refresh token in DB).
 */

import { config } from "dotenv"
import { resolve } from "path"
import { getSalesforceConfig } from "../lib/integrations/salesforce/config"
import { salesforceQuery, salesforceRequest } from "../lib/integrations/salesforce/client"
import { getProduct2UpdateableFields } from "../lib/integrations/salesforce/describe"
import { resolveProductContentFields } from "../lib/integrations/salesforce/content-fields"
import { findProduct2IdByCode } from "../lib/integrations/salesforce/products"
import { syncPackageToSalesforce } from "../lib/integrations/salesforce/products"
import { getSalesforceConnectionStatus } from "../lib/integrations/salesforce/settings-store"
import { createAdminClient } from "../lib/supabase/admin"

config({ path: resolve(process.cwd(), ".env.local") })
config({ path: resolve(process.cwd(), ".env") })

const PRODUCT_CODE = process.env.SF_DIAG_PRODUCT_CODE?.trim() ?? "PR - 000551"

async function main() {
  const args = process.argv.slice(2)
  const syncPackageId = args[0] === "--sync" ? args[1]?.trim() : undefined
  const forceSfId = args[0] === "--sync" ? args[2]?.trim() : undefined

  const status = await getSalesforceConnectionStatus()
  console.log("Connection:", status)
  if (!status.connected) {
    console.error("Not connected. Connect in Admin → Integrations → Salesforce first.")
    process.exit(1)
  }

  const cfg = getSalesforceConfig(status.instanceUrl ?? undefined)
  if (!cfg) {
    console.error("Salesforce config missing.")
    process.exit(1)
  }

  const updateable = await getProduct2UpdateableFields()
  const envFields = [
    ["SALESFORCE_FIELD_UNIT_PRICE", cfg.fieldUnitPrice],
    ["SALESFORCE_FIELD_STOCK_QTY", cfg.fieldStockQty],
    ["SALESFORCE_FIELD_AVAILABLE_QTY", cfg.fieldAvailableQty],
    ["SALESFORCE_FIELD_IMAGE_URL", cfg.fieldImageUrl],
    ["SALESFORCE_FIELD_GALLERY", cfg.fieldGallery],
    ["SALESFORCE_FIELD_INCLUDES", cfg.fieldIncludes],
    ["SALESFORCE_FIELD_BROCHURE_URL", cfg.fieldBrochureUrl],
  ] as const

  console.log("\nConfigured Product2 fields:")
  for (const [env, api] of envFields) {
    if (!api) {
      console.log(`  ${env}: (not set)`)
      continue
    }
    const ok = updateable.has(api)
    console.log(`  ${env} → ${api}: ${ok ? "UPDATEABLE" : "NOT updateable (read-only/formula/wrong name)"}`)
  }

  const contentFields = await resolveProductContentFields(cfg)
  console.log("\nResolved listing content fields (env override or auto-detect):")
  for (const [label, api] of Object.entries(contentFields)) {
    if (!api) {
      console.log(`  ${label}: (not found)`)
      continue
    }
    const ok = updateable.has(api)
    console.log(`  ${label} → ${api}: ${ok ? "UPDATEABLE" : "NOT updateable"}`)
  }

  const allMatches = await salesforceQuery<{
    Id: string
    ProductCode: string
    Name: string
    IsActive: boolean
    Unit_Price__c?: number
    LastModifiedDate: string
  }>(
    `SELECT Id, ProductCode, Name, IsActive, Unit_Price__c, LastModifiedDate FROM Product2 WHERE ProductCode = '${PRODUCT_CODE.replace(/'/g, "\\'")}' ORDER BY LastModifiedDate DESC`,
  )
  console.log(`\nAll Product2 rows with ProductCode "${PRODUCT_CODE}" (${allMatches.length}):`)
  for (const row of allMatches) {
    console.log(
      `  ${row.Id} | active=${row.IsActive} | ${row.Name} | Unit_Price__c=${row.Unit_Price__c} | modified=${row.LastModifiedDate}`,
    )
  }

  const product2Id = await findProduct2IdByCode(PRODUCT_CODE)
  console.log(`\nresolveProduct2Id (LIMIT 1) picks: ${product2Id ?? "NOT FOUND"}`)
  if (!product2Id) process.exit(1)

  const checkIds = process.env.SF_DIAG_CHECK_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [
    "01tV400000QForxIAD",
    "01tWe00000DpTN3IAN",
  ]
  for (const checkId of checkIds) {
    const one = await salesforceQuery<Record<string, unknown>>(
      `SELECT Id, ProductCode, Name, IsActive, Unit_Price__c, Stock_Quantity__c, Available_Quantity__c, LastModifiedDate FROM Product2 WHERE Id = '${checkId}' LIMIT 1`,
    )
    if (one[0]) console.log(`\nRecord ${checkId}:`, one[0])
  }

  const select = [
    "Id",
    "ProductCode",
    "Name",
    "LastModifiedDate",
    cfg.fieldUnitPrice,
    cfg.fieldStockQty,
    cfg.fieldAvailableQty,
    cfg.fieldQuantitySold,
    cfg.fieldValueSold,
  ].filter(Boolean) as string[]

  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${select.join(", ")} FROM Product2 WHERE Id = '${product2Id.replace(/'/g, "\\'")}' LIMIT 1`,
  )
  console.log("\nCurrent Salesforce values:", rows[0])

  const pbe = await salesforceQuery<{ UnitPrice: number; LastModifiedDate: string }>(
    `SELECT UnitPrice, LastModifiedDate FROM PricebookEntry WHERE Product2Id = '${product2Id.replace(/'/g, "\\'")}' AND Pricebook2.IsStandard = true LIMIT 1`,
  )
  console.log("Standard PricebookEntry:", pbe[0] ?? "(none)")

  if (syncPackageId) {
    if (forceSfId) {
      const admin = createAdminClient()
      if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY required for --sync")
      await admin.from("packages").update({ salesforce_product_id: forceSfId }).eq("id", syncPackageId)
      console.log(`Set salesforce_product_id=${forceSfId} on ${syncPackageId}`)
    }
    console.log(`\nRunning sync for package ${syncPackageId}...`)
    const result = await syncPackageToSalesforce(syncPackageId)
    console.log("Sync result:", result)

    const syncedId = result.product2Id
    const after = await salesforceQuery<Record<string, unknown>>(
      `SELECT ${select.join(", ")} FROM Product2 WHERE Id = '${syncedId.replace(/'/g, "\\'")}' LIMIT 1`,
    )
    console.log("\nAfter sync Product2:", after[0])
    const pbeAfter = await salesforceQuery<{ UnitPrice: number }>(
      `SELECT UnitPrice FROM PricebookEntry WHERE Product2Id = '${syncedId.replace(/'/g, "\\'")}' AND Pricebook2.IsStandard = true LIMIT 1`,
    )
    console.log("After sync PricebookEntry:", pbeAfter[0])
  } else {
    console.log("\nTo run a live sync: npx tsx scripts/sf-product-sync-diagnose.ts --sync <package-id>")
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
