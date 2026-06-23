import { salesforceQuery } from "@/lib/integrations/salesforce/client"
import { findProduct2IdByCode } from "@/lib/integrations/salesforce/products"
import { productCodeLookupVariants } from "@/lib/integrations/salesforce/product-code"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

/** Same rules as product sync: prefer explicit Salesforce Product Id on the package. */
export async function resolveProduct2IdForPackage(input: {
  productCode: string | null
  salesforceProductId: string | null
}): Promise<string> {
  const preferredId = input.salesforceProductId?.trim() || null
  const productCode = input.productCode?.trim() || null
  const byCodeId = productCode ? await findProduct2IdByCode(productCode) : null

  if (preferredId) {
    const rows = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM Product2 WHERE Id = '${escapeSoqlString(preferredId)}' LIMIT 1`,
    )
    if (!rows[0]?.Id) {
      throw new Error(`Salesforce Product Id "${preferredId}" was not found.`)
    }
    return rows[0].Id
  }

  if (!byCodeId) {
    if (!productCode) {
      throw new Error(
        "Package is not linked to Salesforce yet. Open Catalog, leave Product Code blank, and run sync — " +
          "or paste the Salesforce Product Id on the package.",
      )
    }
    const variants = productCodeLookupVariants(productCode).join(", ")
    throw new Error(
      `No Salesforce product found for Product Code "${productCode}" (tried: ${variants}). ` +
        `Paste the Salesforce Product Id on the package, or leave Product Code blank and sync to create a new product.`,
    )
  }

  return byCodeId
}
