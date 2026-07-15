import { salesforceRequest } from "@/lib/integrations/salesforce/client"

export type SfFieldDescribe = {
  name: string
  label: string
  updateable: boolean
  calculated: boolean
  custom: boolean
  type: string
  referenceTo?: string[]
  relationshipName?: string | null
}

export type SfChildRelationshipDescribe = {
  childSObject: string
  field: string
  relationshipName: string | null
  cascadeDelete: boolean
  deprecatedAndHidden: boolean
}

let cached: { at: number; fields: SfFieldDescribe[]; updateable: Set<string> } | null = null
const CACHE_MS = 5 * 60 * 1000

async function loadProduct2Describe(): Promise<{ fields: SfFieldDescribe[]; updateable: Set<string> }> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return { fields: cached.fields, updateable: cached.updateable }
  }

  const desc = await salesforceRequest<{ fields: SfFieldDescribe[] }>("GET", "/sobjects/Product2/describe")
  const fields = desc.fields ?? []
  const updateable = new Set(fields.filter((f) => f.updateable && !f.calculated).map((f) => f.name))
  cached = { at: Date.now(), fields, updateable }
  return { fields, updateable }
}

export async function getProduct2UpdateableFields(): Promise<Set<string>> {
  const { updateable } = await loadProduct2Describe()
  return updateable
}

export async function getProduct2Fields(): Promise<SfFieldDescribe[]> {
  const { fields } = await loadProduct2Describe()
  return fields
}

export async function getProduct2ChildRelationships(): Promise<SfChildRelationshipDescribe[]> {
  const desc = await salesforceRequest<{ childRelationships?: SfChildRelationshipDescribe[] }>(
    "GET",
    "/sobjects/Product2/describe",
  )
  return desc.childRelationships ?? []
}

let oliFieldCache: { at: number; fields: SfFieldDescribe[]; updateable: Set<string> } | null = null

async function loadOpportunityLineItemDescribe(): Promise<{
  fields: SfFieldDescribe[]
  updateable: Set<string>
}> {
  if (oliFieldCache && Date.now() - oliFieldCache.at < CACHE_MS) {
    return { fields: oliFieldCache.fields, updateable: oliFieldCache.updateable }
  }
  const desc = await salesforceRequest<{ fields: SfFieldDescribe[] }>(
    "GET",
    "/sobjects/OpportunityLineItem/describe",
  )
  const fields = desc.fields ?? []
  const updateable = new Set(fields.filter((f) => f.updateable && !f.calculated).map((f) => f.name))
  oliFieldCache = { at: Date.now(), fields, updateable }
  return { fields, updateable }
}

/** Resolve Opportunity Product custom fields by env override or label (Supplier / Buy Price). */
export async function resolveOpportunityLineItemSupplyFields(): Promise<{
  supplierField: string | null
  buyPriceField: string | null
}> {
  const envSupplier = process.env.SALESFORCE_FIELD_OLI_SUPPLIER?.trim() || null
  const envBuy = process.env.SALESFORCE_FIELD_OLI_BUY_PRICE?.trim() || null
  if (envSupplier && envBuy) {
    return { supplierField: envSupplier, buyPriceField: envBuy }
  }

  const { fields, updateable } = await loadOpportunityLineItemDescribe()
  const pick = (labels: string[], env: string | null, fallbacks: string[]): string | null => {
    if (env && updateable.has(env)) return env
    for (const fb of fallbacks) {
      if (updateable.has(fb)) return fb
    }
    const wanted = new Set(labels.map((l) => l.toLowerCase()))
    for (const f of fields) {
      if (!updateable.has(f.name)) continue
      if (wanted.has((f.label ?? "").trim().toLowerCase())) return f.name
    }
    return null
  }

  return {
    supplierField: pick(["Supplier"], envSupplier, ["Supplier__c"]),
    buyPriceField: pick(["Buy Price", "Buy price", "Cost"], envBuy, [
      "Buy_Price__c",
      "BuyPrice__c",
      "Cost__c",
    ]),
  }
}

export async function assertProduct2FieldUpdateable(fieldApiName: string): Promise<void> {
  const ok = await getProduct2UpdateableFields()
  if (!ok.has(fieldApiName)) {
    throw new Error(
      `Salesforce field "${fieldApiName}" on Product is not API-updateable (read-only, formula, or wrong API name). ` +
        `Confirm the API name in Setup → Object Manager → Product → Fields.`,
    )
  }
}
