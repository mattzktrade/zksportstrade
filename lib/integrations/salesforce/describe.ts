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

let cached: {
  at: number
  fields: SfFieldDescribe[]
  updateable: Set<string>
  childRelationships: SfChildRelationshipDescribe[]
} | null = null
const CACHE_MS = 30 * 60 * 1000

async function loadProduct2Describe(): Promise<{
  fields: SfFieldDescribe[]
  updateable: Set<string>
  childRelationships: SfChildRelationshipDescribe[]
}> {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return {
      fields: cached.fields,
      updateable: cached.updateable,
      childRelationships: cached.childRelationships,
    }
  }

  const desc = await salesforceRequest<{
    fields: SfFieldDescribe[]
    childRelationships?: SfChildRelationshipDescribe[]
  }>("GET", "/sobjects/Product2/describe")
  const fields = desc.fields ?? []
  const updateable = new Set(fields.filter((f) => f.updateable && !f.calculated).map((f) => f.name))
  const childRelationships = desc.childRelationships ?? []
  cached = { at: Date.now(), fields, updateable, childRelationships }
  return { fields, updateable, childRelationships }
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
  const { childRelationships } = await loadProduct2Describe()
  return childRelationships
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

  const { fields, updateable } = await loadOpportunityLineItemDescribe()
  const byName = new Map(fields.map((f) => [f.name, f]))

  /** Portal suppliers are free-text names — never write those into a Lookup/Id field. */
  const isTextLikeSupplierField = (apiName: string): boolean => {
    const f = byName.get(apiName)
    if (!f || !updateable.has(apiName)) return false
    const t = (f.type ?? "").toLowerCase()
    return t === "string" || t === "textarea" || t === "picklist" || t === "combobox"
  }

  const pickBuy = (labels: string[], env: string | null, fallbacks: string[]): string | null => {
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

  const pickSupplier = (labels: string[], env: string | null, fallbacks: string[]): string | null => {
    if (env) {
      if (isTextLikeSupplierField(env)) return env
      // Env points at a Lookup — skip rather than send "Test (4), Matt (3)" as an Id.
      return null
    }
    for (const fb of fallbacks) {
      if (isTextLikeSupplierField(fb)) return fb
    }
    const wanted = new Set(labels.map((l) => l.toLowerCase()))
    for (const f of fields) {
      if (!isTextLikeSupplierField(f.name)) continue
      if (wanted.has((f.label ?? "").trim().toLowerCase())) return f.name
    }
    return null
  }

  return {
    supplierField: pickSupplier(["Supplier"], envSupplier, ["Supplier__c"]),
    buyPriceField: pickBuy(["Buy Price", "Buy price", "Cost"], envBuy, [
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
