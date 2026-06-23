import { config } from "dotenv"
import { resolve } from "path"
import { productCodeLookupVariants } from "../lib/integrations/salesforce/product-code"
import { findProduct2IdByCode } from "../lib/integrations/salesforce/products"
import { salesforceQuery } from "../lib/integrations/salesforce/client"

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })
  const code = process.argv[2] ?? "PR - 000464"
  console.log("Variants:", productCodeLookupVariants(code))
  const foundId = await findProduct2IdByCode(code)
  console.log("findProduct2IdByCode:", foundId)

  for (const v of productCodeLookupVariants(code)) {
    const esc = v.replace(/'/g, "\\'")
    const rows = await salesforceQuery<{ Id: string; ProductCode: string; Name: string }>(
      `SELECT Id, ProductCode, Name FROM Product2 WHERE ProductCode = '${esc}' LIMIT 5`,
    )
    console.log(`Exact '${v}':`, rows.length ? rows : "none")
  }

  const like = await salesforceQuery<{ Id: string; ProductCode: string; Name: string }>(
    `SELECT Id, ProductCode, Name FROM Product2 WHERE ProductCode LIKE '%464%' LIMIT 15`,
  )
  console.log("LIKE %464%:", like)

  const north = await salesforceQuery<{ Id: string; ProductCode: string; Name: string }>(
    `SELECT Id, ProductCode, Name FROM Product2 WHERE Name LIKE '%North Straight%' LIMIT 10`,
  )
  console.log("Name North Straight:", north)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
