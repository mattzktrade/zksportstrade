/** Packages whose name includes this phrase default to manual booking approval. */
export const PADDOCK_CLUB_NAME_MARKER = "paddock club"

export const PADDOCK_CLUB_BOOKING_DISCLAIMER = `Paddock Club hospitality is subject to Formula 1 and circuit approval. We can only confirm Paddock Club sales to clients who meet the official eligibility criteria.

By submitting this request you confirm that:
• You have discussed eligibility with your client and believe they qualify to purchase Paddock Club.
• This is a booking request only — it is not confirmed until ZK Sports & Entertainment approves it.
• If we cannot approve the sale, we will notify you and no booking will be created.

Our team will review your request and email you once a decision has been made.`

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
