export const ACCOUNT_KINDS = [
  "concierge",
  "travel_agency",
  "ticket_agent",
  "hospitality_agency",
  "direct_client",
  "supplier",
  "other",
] as const

export type AccountKind = (typeof ACCOUNT_KINDS)[number]

export const ACCOUNT_KIND_OPTIONS: { id: AccountKind; label: string }[] = [
  { id: "concierge", label: "Concierge company" },
  { id: "travel_agency", label: "Travel agency" },
  { id: "ticket_agent", label: "Ticket agent" },
  { id: "hospitality_agency", label: "Hospitality agency" },
  { id: "direct_client", label: "Direct client" },
  { id: "supplier", label: "Supplier" },
  { id: "other", label: "Other" },
]

const KIND_SET = new Set<string>(ACCOUNT_KINDS)

const CUSTOMER_KINDS = new Set<AccountKind>([
  "concierge",
  "travel_agency",
  "ticket_agent",
  "hospitality_agency",
])

export function isAccountKind(value: string): value is AccountKind {
  return KIND_SET.has(value)
}

export function parseAccountKinds(value: unknown): AccountKind[] {
  const raw = Array.isArray(value) ? value : []
  const unique: AccountKind[] = []
  for (const item of raw) {
    if (typeof item !== "string" || !isAccountKind(item) || unique.includes(item)) continue
    unique.push(item)
  }
  return unique
}

export function accountKindLabel(kind: AccountKind): string {
  return ACCOUNT_KIND_OPTIONS.find((option) => option.id === kind)?.label ?? kind
}

export function accountKindLabels(kinds: AccountKind[]): string {
  if (kinds.length === 0) return "Unspecified"
  return kinds.map(accountKindLabel).join(" · ")
}

/** Keep the legacy single account_type used by billing / Xero. */
export function primaryAccountType(kinds: AccountKind[]): string {
  if (kinds.some((kind) => CUSTOMER_KINDS.has(kind))) return "agent_company"
  if (kinds.includes("direct_client")) return "direct_client"
  if (kinds.includes("supplier")) return "supplier_related"
  if (kinds.includes("other")) return "other"
  return "agent_company"
}
