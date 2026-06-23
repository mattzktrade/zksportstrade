import { SalesforceApiError } from "@/lib/integrations/salesforce/client"

export function formatSalesforceSyncError(e: unknown, context: string): Error {
  if (!(e instanceof SalesforceApiError)) {
    return e instanceof Error ? e : new Error(`${context}: ${String(e)}`)
  }

  const msg = e.message
  const lower = msg.toLowerCase()

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
