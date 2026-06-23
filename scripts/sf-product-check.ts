import { config } from "dotenv"
import { resolve } from "path"
import { salesforceQuery } from "../lib/integrations/salesforce/client"

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })

  const ids = ["01tV400000QForxIAD", "01tWe00000DpTN3IAN"]

  for (const id of ids) {
    const rows = await salesforceQuery<Record<string, unknown>>(
      `SELECT Id, ProductCode, Name, IsActive, Unit_Price__c, Stock_Quantity__c, Available_Quantity__c, LastModifiedDate FROM Product2 WHERE Id = '${id}' LIMIT 1`,
    )
    console.log(JSON.stringify(rows[0], null, 2))
  }

  const dup = await salesforceQuery<Record<string, unknown>>(
    `SELECT Id, ProductCode, Name, IsActive, Unit_Price__c, LastModifiedDate FROM Product2 WHERE ProductCode = 'PR - 000551' ORDER BY LastModifiedDate DESC`,
  )
  console.log("All PR - 000551:", dup.length, JSON.stringify(dup, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
