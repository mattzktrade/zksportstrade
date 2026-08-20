export function eventSeasonLabel(
  name: string,
  season: number | null | undefined,
): string {
  const trimmed = name.trim()
  if (!season || new RegExp(`\\b${season}\\b`).test(trimmed)) return trimmed
  return `${season} ${trimmed}`
}

