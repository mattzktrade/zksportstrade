import { SalesforceApiError } from "@/lib/integrations/salesforce/client"

export function isSalesforceDuplicateError(e: unknown): boolean {
  if (!(e instanceof SalesforceApiError)) return false
  const m = e.message.toLowerCase()
  return m.includes("duplicate") || m.includes("duplicates_value") || m.includes("duplicaterule")
}

/** Extract a matched record Id from Salesforce DUPLICATES_DETECTED API errors. */
export function extractDuplicateRecordId(e: unknown, entityType?: string): string | null {
  if (!(e instanceof SalesforceApiError)) return null
  const arr = Array.isArray(e.body) ? e.body : null
  if (!arr?.length) return null

  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const duplicateResult = (item as { duplicateResult?: unknown }).duplicateResult
    if (!duplicateResult || typeof duplicateResult !== "object") continue

    const matchResults = (duplicateResult as { matchResults?: unknown[] }).matchResults
    if (!Array.isArray(matchResults)) continue

    for (const match of matchResults) {
      if (!match || typeof match !== "object") continue
      if (entityType && (match as { entityType?: string }).entityType !== entityType) continue

      const matchRecords = (match as { matchRecords?: unknown[] }).matchRecords
      if (!Array.isArray(matchRecords)) continue

      for (const record of matchRecords) {
        if (!record || typeof record !== "object") continue
        const rec = (record as { record?: { Id?: string } }).record
        const id = rec?.Id?.trim()
        if (id) return id
      }
    }
  }

  return null
}
