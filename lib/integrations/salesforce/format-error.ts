import { SalesforceApiError } from "@/lib/integrations/salesforce/client"

export function isSalesforceApiLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /TotalRequests|REQUEST_LIMIT_EXCEEDED|api.?limit/i.test(msg)
}

/** Supplier text written into a Lookup/Id field — permanent config mismatch, do not retry. */
export function isSalesforceSupplierIdTypeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /Supplier.*id value of incorrect type|id value of incorrect type:.*\(/i.test(msg)
}

export function formatSalesforceSyncError(e: unknown, context: string): Error {
  if (!(e instanceof SalesforceApiError)) {
    return e instanceof Error ? e : new Error(`${context}: ${String(e)}`)
  }

  const msg = e.message
  const lower = msg.toLowerCase()

  if (isSalesforceApiLimitError(e)) {
    return new Error(
      `${context}: Salesforce API daily request limit exceeded. Automatic sync pauses until the limit resets ` +
        `(typically overnight). Avoid Process sync queue / full catalog sync until then. ` +
        `Offline sales can still be pulled with the light offline-only action once requests are available.`,
    )
  }

  if (isSalesforceSupplierIdTypeError(e)) {
    return new Error(
      `${context}: Opportunity Product "Supplier" is a Lookup/Id field in Salesforce, but the portal sends ` +
        `supplier names (e.g. "Test (4), Matt (3)"). Skip writing Supplier or change the SF field to Text. ` +
        `Details: ${msg.slice(0, 400)}`,
    )
  }

  if (msg.includes("dlrs_") || lower.includes("invalid_cross_reference_key")) {
    return new Error(
      `${context}: Salesforce DLRS rollup automation failed when saving the order line (Product ${extractSfId(msg, "01t") ?? "see SF"}). ` +
        `This is a Salesforce configuration issue — ask your SF admin to review **Declarative Lookup Rollup Summaries** on Product2 ` +
        `(rollup record may reference a blank lookup — error mentions a0N…). ` +
        `Until fixed, set \`SALESFORCE_ORDER_SKIP_LINE_ITEMS=true\` in env to create Opportunities without line items (for sandbox testing). ` +
        `Details: ${msg.slice(0, 600)}`,
    )
  }

  if (lower.includes("field_custom_validation") || lower.includes("validation_rule")) {
    return new Error(`${context}: Salesforce validation rule blocked the save. ${msg.slice(0, 500)}`)
  }

  if (lower.includes("duplicate")) {
    return new Error(
      `${context}: Salesforce duplicate rule blocked the save (often same Opportunity name + Account for a repeat booking). ` +
        `Each portal order now gets a unique Opportunity name. Re-process the sync queue for this order. ${msg.slice(0, 400)}`,
    )
  }

  return new Error(`${context}: ${msg.slice(0, 900)}`)
}

function extractSfId(msg: string, prefix: string): string | null {
  const re = new RegExp(`\\b(${prefix}[a-zA-Z0-9]{12,18})\\b`)
  const m = msg.match(re)
  return m?.[1] ?? null
}
