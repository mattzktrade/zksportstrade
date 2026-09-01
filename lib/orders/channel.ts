export type PackageSalesChannelBucket = "wix" | "offline" | "portal"

/**
 * Bucket used by Places Sold (Portal / Website / Offline).
 * Native CRM deals convert to orders with channel `native_deal` — those are
 * offline sales, not trade-portal checkouts.
 */
export function classifySalesChannel(channel: string | null | undefined): PackageSalesChannelBucket {
  const normalized = (channel ?? "").trim().toLowerCase()
  if (normalized === "wix" || normalized === "website") return "wix"
  if (
    normalized === "offline" ||
    normalized === "admin" ||
    normalized === "native_deal" ||
    normalized === "other" ||
    normalized === "referral" ||
    normalized === "salesforce_import"
  ) {
    return "offline"
  }
  return "portal"
}

/** Product-page / order-list channel label. Native/offline deals win over a defaulted portal channel. */
export function orderSaleChannelLabel(input: {
  channel?: string | null
  dealSource?: string | null
}): string {
  const channel = (input.channel ?? "").trim().toLowerCase()
  const source = (input.dealSource ?? "").trim().toLowerCase()

  if (channel === "wix") return "Website"
  if (channel === "partner_api") return "Partner"
  if (channel === "native_deal" || channel === "admin" || channel === "offline") {
    return "Offline deal"
  }

  if (source === "website") return "Website"
  if (source === "portal") return "Portal"
  if (source === "offline" || source === "other" || source === "referral") {
    return "Offline deal"
  }
  if (source) return "Offline deal"

  if (channel === "trade_portal") return "Portal"

  const bucket = classifySalesChannel(channel)
  if (bucket === "wix") return "Website"
  if (bucket === "offline") return "Offline deal"
  return "Portal"
}

export function isPortalCheckoutChannel(channel: string | null | undefined): boolean {
  const normalized = (channel ?? "").trim().toLowerCase()
  return normalized === "trade_portal" || normalized === "partner_api" || normalized === ""
}

export function orderPartyPrimary(input: {
  agentCompany?: string | null
  agentName?: string | null
  accountName?: string | null
  contactName?: string | null
  clientName?: string | null
}): string {
  return (
    input.accountName?.trim() ||
    input.agentCompany?.trim() ||
    input.contactName?.trim() ||
    input.agentName?.trim() ||
    input.clientName?.trim() ||
    "—"
  )
}
