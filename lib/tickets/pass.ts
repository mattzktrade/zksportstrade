/** Guest-facing short code, spaced as on the pass: ZK - ABC123. */
export function displayTicketShortCode(code: string): string {
  const trimmed = code.trim().toUpperCase()
  const match = trimmed.match(/^ZK-([0-9A-Z]+)$/)
  if (match?.[1]) return `ZK - ${match[1]}`
  return trimmed || "ZK"
}

/** Last word in ZK red, same idea as the brochure cover title. */
export function accentGuestName(fullName: string): { lead: string; accent: string } {
  const parts = fullName
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
  if (parts.length === 0) return { lead: "", accent: "Guest" }
  if (parts.length === 1) return { lead: "", accent: parts[0] ?? "Guest" }
  return { lead: parts.slice(0, -1).join(" "), accent: parts[parts.length - 1] ?? "Guest" }
}

export function guestHasHeadshot(path: string | null | undefined): boolean {
  return Boolean(path?.trim())
}
