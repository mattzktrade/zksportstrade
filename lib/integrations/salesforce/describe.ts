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

export async function assertProduct2FieldUpdateable(fieldApiName: string): Promise<void> {
  const ok = await getProduct2UpdateableFields()
  if (!ok.has(fieldApiName)) {
    throw new Error(
      `Salesforce field "${fieldApiName}" on Product is not API-updateable (read-only, formula, or wrong API name). ` +
        `Confirm the API name in Setup → Object Manager → Product → Fields.`,
    )
  }
}
