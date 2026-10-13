function tidyPartyName(value: string | null | undefined): string {
  return (value ?? "")
    .replaceAll("\u00a0", " ")
    .replaceAll("\u202f", " ")
    .replaceAll("\u200b", "")
    .trim()
    .replace(/\s+/g, " ")
}

function samePartyName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * BILL TO lines: account name, then contact full name.
 * Direct clients often use the same string for both; in that case only the full name is shown.
 * Agency/company accounts still show both when the names differ.
 */
export function billToPartyNames(
  accountName: string | null | undefined,
  fullName: string | null | undefined,
): string[] {
  const account = tidyPartyName(accountName)
  const full = tidyPartyName(fullName)
  if (!account && !full) return []
  if (!full) return [account]
  if (!account || samePartyName(account, full)) return [full]
  return [account, full]
}
