/** Build a URL-safe package id from race + display name (internal slug, not shown in admin UI). */
export function slugifyPackageIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function generatePackageIdFromRaceAndName(raceId: string, name: string): string {
  const racePart = slugifyPackageIdPart(raceId).slice(0, 48)
  const namePart = slugifyPackageIdPart(name).slice(0, 72)
  const combined = [racePart, namePart].filter(Boolean).join("-")
  const base = combined || "package"
  return base.slice(0, 127)
}
