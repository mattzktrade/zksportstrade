/** Packages whose name includes this phrase default to manual booking approval. */
export const PADDOCK_CLUB_NAME_MARKER = "paddock club"

/** @deprecated Use buildPaddockClubBookingDisclaimer() for agent-specific agency name. */
export const PADDOCK_CLUB_BOOKING_DISCLAIMER = buildPaddockClubBookingDisclaimer()

export function buildPaddockClubBookingDisclaimer(agentAgencyLabel?: string | null): string {
  const agency = agentAgencyLabel?.trim() || "your agency"

  return `How we sell Paddock Club (most trade partners)
For most sales we will need to reach out to your client directly. We will introduce ourselves by email as the fulfilment partner of ${agency} for the Paddock Club, and confirm that they will attend as a guest of ZK Sports & Entertainment at the event.

Official authorised F1 Paddock Club agents
If you are an official authorised F1 Paddock Club agent, you may ignore the above and sell under your own authorised arrangements.

By submitting this request you confirm this is a request only — not a confirmed booking — and that the fulfilment approach above applies unless you are an authorised agent.

Requests are typically approved within an hour. A booking confirmation email is sent as soon as your request is approved.`
}

export function isPaddockClubPackageName(name: string): boolean {
  return name.toLowerCase().includes(PADDOCK_CLUB_NAME_MARKER)
}

export function packageRequiresBookingApproval(
  pkg: { name: string; requiresBookingApproval?: boolean | null },
): boolean {
  if (pkg.requiresBookingApproval === true) return true
  if (pkg.requiresBookingApproval === false) return false
  return isPaddockClubPackageName(pkg.name)
}
