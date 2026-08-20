export type PlatformRuntimeMode = "legacy" | "native"

/**
 * The first-build CMS is native-only. Salesforce is retired from runtime:
 * no connect, pull, opportunity sync, or shell generation.
 * Historical Salesforce IDs on imported deals/accounts remain in the database.
 */
export function getPlatformRuntimeMode(): PlatformRuntimeMode {
  return "native"
}

export function isNativePlatformMode(): boolean {
  return true
}

export function isSalesforceRuntimeEnabled(): boolean {
  return false
}
