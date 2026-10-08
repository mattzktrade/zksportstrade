/** Apple/Google Wallet pass generation. Certificates live in env — never in git. */

export type WalletIssuerKind = "apple" | "google"

export type WalletPassStatus = "ready" | "not_configured"

export function appleWalletConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.APPLE_PASS_TYPE_ID?.trim() &&
      env.APPLE_TEAM_ID?.trim() &&
      env.APPLE_PASS_CERT?.trim() &&
      env.APPLE_PASS_KEY?.trim() &&
      env.APPLE_WWDR_CERT?.trim(),
  )
}

export function googleWalletConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_WALLET_ISSUER_ID?.trim() && env.GOOGLE_WALLET_SA_JSON?.trim())
}

export function walletPassStatus(env: NodeJS.ProcessEnv = process.env): Record<WalletIssuerKind, WalletPassStatus> {
  return {
    apple: appleWalletConfigured(env) ? "ready" : "not_configured",
    google: googleWalletConfigured(env) ? "ready" : "not_configured",
  }
}

export function walletUnavailableMessage(kind: WalletIssuerKind): string {
  if (kind === "apple") {
    return "Apple Wallet needs a Pass Type ID and certificates in Apple Developer. Add them, then this button will download a pass."
  }
  return "Google Wallet needs an issuer account in Google Pay & Wallet Console. Add it, then this button will add the pass."
}
