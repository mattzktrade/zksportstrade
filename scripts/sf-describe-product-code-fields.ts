import { config } from "dotenv"
import { resolve } from "path"
import { getProduct2Fields } from "../lib/integrations/salesforce/describe"
import { salesforceQuery } from "../lib/integrations/salesforce/client"

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })
  const id = process.argv[2] ?? "01tV400000ObMGjIAN"

  const fields = await getProduct2Fields()
  const codeFields = fields.filter(
    (f) =>
      /product.?code/i.test(f.name) ||
      /^product_code__c$/i.test(f.name) ||
      /product\s*code/i.test(f.label ?? ""),
  )
  console.log(
    "Code-like fields:",
    codeFields.map((f) => ({ name: f.name, label: f.label, type: f.type })),
  )

  const fieldNames = [...new Set(codeFields.map((f) => f.name))]
  const selectList = ["Id", "Name", ...fieldNames].join(", ")
  const rows = await salesforceQuery<Record<string, unknown>>(
    `SELECT ${selectList} FROM Product2 WHERE Id = '${id}' LIMIT 1`,
  )
  console.log("Product row:", JSON.stringify(rows[0], null, 2))

  for (const f of codeFields) {
    if (f.name === "ProductCode") continue
    const esc = "PR - 000464".replace(/'/g, "\\'")
    try {
      const hits = await salesforceQuery<{ Id: string; Name: string }>(
        `SELECT Id, Name FROM Product2 WHERE ${f.name} = '${esc}' LIMIT 3`,
      )
      if (hits.length) console.log(`Found via ${f.name}:`, hits)
    } catch (e) {
      console.log(`Query ${f.name} failed:`, e instanceof Error ? e.message : e)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
