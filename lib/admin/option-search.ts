export function adminSearchTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

export function adminSearchTextMatches(text: string, query: string): boolean {
  const tokens = adminSearchTokens(query)
  if (tokens.length === 0) return true
  const haystack = text.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

export type AdminSearchableOption = {
  label: string
  eventName?: string
  packageName?: string
}

function optionHaystack(option: AdminSearchableOption): string {
  return `${option.label} ${option.eventName ?? ""} ${option.packageName ?? ""}`
}

function optionScore(option: AdminSearchableOption, tokens: string[]): number {
  const packageName = (option.packageName ?? "").toLowerCase()
  const eventName = (option.eventName ?? "").toLowerCase()
  const packageHits = tokens.filter((token) => packageName.includes(token)).length
  const eventHits = tokens.filter((token) => eventName.includes(token)).length
  return packageHits * 20 + eventHits
}

/** Token match across event and product names, ranked so specific product words float up. */
export function searchAdminProductOptions<T extends AdminSearchableOption>(
  options: T[],
  query: string,
): T[] {
  const tokens = adminSearchTokens(query)
  if (tokens.length === 0) return []
  return options
    .filter((option) => {
      const haystack = optionHaystack(option).toLowerCase()
      return tokens.every((token) => haystack.includes(token))
    })
    .sort(
      (a, b) =>
        optionScore(b, tokens) - optionScore(a, tokens) ||
        a.label.localeCompare(b.label),
    )
}
