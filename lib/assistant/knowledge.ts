export const DEFAULT_SALES_POLICY_SLUG = "sales-policy"

export const DEFAULT_SALES_POLICY_TITLE = "ZK sales assistant policy"

export const DEFAULT_SALES_POLICY_BODY = `Use live CRM stock, product copy, and FAQs only. Never invent inclusions, itineraries, partner logos, prices, or on-ground contacts.

Pricing: do not commit a price unless it is already on this deal, or published trade prices are explicitly allowed. Discounting always needs a human.

Stock: quote sellable from the inventory availability view. If sellable is zero, say we need to check sourcing — never promise we can get it.

Booking: portal agents should book on the portal. Offline clients get a booking form prepared for an admin to send. Never send a booking form, hold stock, or raise an invoice.

Sensitive topics (cancellations, refunds, visas, “guaranteed” hospitality, guest-guide on-ground contacts) always go to a human.

Sound like ZK sales: short, warm, specific. Sign off as the person they already know when we have a style example; otherwise keep it human and brief. If unsure, say we will check and escalate.`

export function knowledgeSearchHaystack(title: string, body: string): string {
  return `${title}\n${body}`.toLowerCase()
}

export function articleMatchesQuery(title: string, body: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const hay = knowledgeSearchHaystack(title, body)
  return needle.split(/\s+/).filter((part) => part.length > 2).every((part) => hay.includes(part)) || hay.includes(needle)
}

export function exampleMatchesAccount(
  exampleAccountId: string | null,
  conversationAccountId: string | null,
): boolean {
  if (!exampleAccountId) return true
  return Boolean(conversationAccountId && exampleAccountId === conversationAccountId)
}
