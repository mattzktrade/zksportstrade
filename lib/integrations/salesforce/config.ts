export type SalesforceConfig = {
  clientId: string
  clientSecret: string
  instanceUrl: string
  loginUrl: string
  apiVersion: string
  defaultOwnerId: string | null
  productFamily: string
  opportunityStage: string
  /** Set when portal invoice is paid — must be a stage where Opportunity Is Won = true (e.g. Closed Won). */
  opportunityStageWon: string
  /** Set when order is cancelled / never paid. */
  opportunityStageLost: string
  packageItemObject: string | null
  packageItemParentProductField: string | null
  packageItemChildProductField: string | null
  packageItemQuantityField: string | null
  packageItemSortOrderField: string | null
  fieldAvailableQty: string | null
  fieldStockQty: string | null
  /** Custom Unit Price on Product2 (feeds SF flows that auto-create pricebook entries). */
  fieldUnitPrice: string | null
  /** Read-only: used to preserve Quantity Sold when syncing available stock. */
  fieldQuantitySold: string | null
  fieldValueSold: string | null
  fieldPortalRef: string | null
  fieldChannel: string | null
  /** Lookup field on Product2 that points to the Event record (e.g. Event_Name__c). Auto-detected if blank. */
  fieldEvent: string | null
  /** Field on Product2 that records where the stock was bought from (e.g. Source__c). Auto-detected if blank. */
  fieldSource: string | null
  /** Phase 3 — listing content (auto-detected when blank). */
  fieldImageUrl: string | null
  fieldGallery: string | null
  fieldIncludes: string | null
  fieldBrochureUrl: string | null
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim()
  return v && v.length > 0 ? v : undefined
}

export function isSalesforceConfigured(): boolean {
  return Boolean(trimEnv("SALESFORCE_CLIENT_ID") && trimEnv("SALESFORCE_CLIENT_SECRET"))
}

export function getSalesforceConfig(instanceUrlOverride?: string): SalesforceConfig | null {
  const clientId = trimEnv("SALESFORCE_CLIENT_ID")
  const clientSecret = trimEnv("SALESFORCE_CLIENT_SECRET")
  if (!clientId || !clientSecret) return null

  const instanceUrl = (instanceUrlOverride ?? trimEnv("SALESFORCE_INSTANCE_URL") ?? "").replace(/\/$/, "")
  if (!instanceUrl) return null

  const isSandbox = instanceUrl.includes(".sandbox.") || trimEnv("SALESFORCE_USE_SANDBOX") === "true"
  const loginUrl = trimEnv("SALESFORCE_LOGIN_URL") ?? (isSandbox ? "https://test.salesforce.com" : "https://login.salesforce.com")

  return {
    clientId,
    clientSecret,
    instanceUrl,
    loginUrl,
    apiVersion: trimEnv("SALESFORCE_API_VERSION") ?? "v59.0",
    defaultOwnerId: trimEnv("SALESFORCE_DEFAULT_OWNER_ID") ?? null,
    productFamily: trimEnv("SALESFORCE_PRODUCT_FAMILY") ?? "Package",
    opportunityStage: trimEnv("SALESFORCE_OPPORTUNITY_STAGE") ?? "Proposal",
    opportunityStageWon: trimEnv("SALESFORCE_OPPORTUNITY_STAGE_WON") ?? "Closed Won",
    opportunityStageLost: trimEnv("SALESFORCE_OPPORTUNITY_STAGE_LOST") ?? "Closed Lost",
    packageItemObject: trimEnv("SALESFORCE_PACKAGE_ITEM_OBJECT") ?? null,
    packageItemParentProductField: trimEnv("SALESFORCE_PACKAGE_ITEM_PARENT_PRODUCT_FIELD") ?? null,
    packageItemChildProductField: trimEnv("SALESFORCE_PACKAGE_ITEM_CHILD_PRODUCT_FIELD") ?? null,
    packageItemQuantityField: trimEnv("SALESFORCE_PACKAGE_ITEM_QUANTITY_FIELD") ?? null,
    packageItemSortOrderField: trimEnv("SALESFORCE_PACKAGE_ITEM_SORT_ORDER_FIELD") ?? null,
    fieldAvailableQty: trimEnv("SALESFORCE_FIELD_AVAILABLE_QTY") ?? "Available_Quantity__c",
    fieldStockQty: trimEnv("SALESFORCE_FIELD_STOCK_QTY") ?? "Stock_Quantity__c",
    fieldUnitPrice: trimEnv("SALESFORCE_FIELD_UNIT_PRICE") ?? "Unit_Price__c",
    fieldQuantitySold: trimEnv("SALESFORCE_FIELD_QUANTITY_SOLD") ?? "Quantity_Sold__c",
    fieldValueSold: trimEnv("SALESFORCE_FIELD_VALUE_SOLD") ?? "Value_Sold__c",
    fieldPortalRef: trimEnv("SALESFORCE_FIELD_PORTAL_ORDER_REF") ?? null,
    fieldChannel: trimEnv("SALESFORCE_FIELD_CHANNEL") ?? null,
    fieldEvent: trimEnv("SALESFORCE_FIELD_EVENT") ?? "Event_Name__c",
    fieldSource: trimEnv("SALESFORCE_FIELD_SOURCE") ?? "Source__c",
    // portalwix sandbox API names (note: Image_URL_c__c not Image_URL__c — see PHASE3 doc)
    fieldImageUrl: trimEnv("SALESFORCE_FIELD_IMAGE_URL") ?? "Image_URL_c__c",
    fieldGallery: trimEnv("SALESFORCE_FIELD_GALLERY") ?? "Gallery_Images_c__c",
    fieldIncludes: trimEnv("SALESFORCE_FIELD_INCLUDES") ?? "Inclusions__c",
    fieldBrochureUrl: trimEnv("SALESFORCE_FIELD_BROCHURE_URL") ?? "Brochure_URL_c__c",
  }
}

export function getOAuthRedirectUri(requestOrigin: string): string {
  const override = trimEnv("SALESFORCE_REDIRECT_URI")
  if (override) return override
  return `${requestOrigin.replace(/\/$/, "")}/api/integrations/salesforce/callback`
}
