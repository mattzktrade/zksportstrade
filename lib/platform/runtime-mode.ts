export type PlatformRuntimeMode = "legacy" | "native"

/**
 * Native mode is deliberately opt-in so existing production deployments retain
 * legacy behaviour until the rebuild has completed its local/staging checks.
 */
export function getPlatformRuntimeMode(): PlatformRuntimeMode {
  return process.env.ZK_PLATFORM_MODE?.trim().toLowerCase() === "native"
    ? "native"
    : "legacy"
}

export function isNativePlatformMode(): boolean {
  return getPlatformRuntimeMode() === "native"
}

export function isSalesforceRuntimeEnabled(): boolean {
  return !isNativePlatformMode()
}
