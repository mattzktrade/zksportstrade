import { config } from "dotenv"
import { resolve } from "path"
import { salesforceRequest } from "../lib/integrations/salesforce/client"
import { getProduct2ChildRelationships } from "../lib/integrations/salesforce/describe"

type ObjectDescribe = {
  fields?: Array<{
    name: string
    label: string
    type: string
    referenceTo?: string[]
    updateable: boolean
    createable: boolean
  }>
}

async function main() {
  config({ path: resolve(process.cwd(), ".env.local") })

  const relationships = await getProduct2ChildRelationships()
  const candidates = relationships.filter((r) => {
    const haystack = `${r.childSObject} ${r.field} ${r.relationshipName ?? ""}`.toLowerCase()
    return haystack.includes("package") || haystack.includes("item") || haystack.includes("product")
  })

  console.log("Product2 child relationship candidates:")
  for (const rel of candidates) {
    console.log(
      JSON.stringify(
        {
          childSObject: rel.childSObject,
          field: rel.field,
          relationshipName: rel.relationshipName,
        },
        null,
        2,
      ),
    )

    try {
      const desc = await salesforceRequest<ObjectDescribe>("GET", `/sobjects/${rel.childSObject}/describe`)
      const fields = (desc.fields ?? []).filter((f) => {
        const haystack = `${f.name} ${f.label} ${(f.referenceTo ?? []).join(" ")}`.toLowerCase()
        return haystack.includes("product") || haystack.includes("package") || haystack.includes("quantity") || haystack.includes("sort")
      })
      console.log("  relevant fields:")
      for (const f of fields) {
        console.log(
          `  - ${f.name} (${f.label}) type=${f.type} ref=${(f.referenceTo ?? []).join(",") || "-"} createable=${f.createable} updateable=${f.updateable}`,
        )
      }
    } catch (e) {
      console.log(`  describe failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log("\nSet these env vars once the Package Items object is identified:")
  console.log("SALESFORCE_PACKAGE_ITEM_OBJECT=")
  console.log("SALESFORCE_PACKAGE_ITEM_PARENT_PRODUCT_FIELD=")
  console.log("SALESFORCE_PACKAGE_ITEM_CHILD_PRODUCT_FIELD=")
  console.log("SALESFORCE_PACKAGE_ITEM_QUANTITY_FIELD=")
  console.log("SALESFORCE_PACKAGE_ITEM_SORT_ORDER_FIELD= # optional")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
