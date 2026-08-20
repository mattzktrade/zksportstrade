function decodeHeader(value: string | null): string {
  if (!value) return ""
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getRequestEvidence(headersList: Headers): {
  ipAddress: string | null
  location: string | null
  userAgent: string | null
} {
  const ipAddress =
    (
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip")?.trim() ||
      ""
    ).slice(0, 64) || null
  const city = decodeHeader(
    headersList.get("x-vercel-ip-city") || headersList.get("cf-ipcity"),
  ).trim()
  const country = decodeHeader(
    headersList.get("x-vercel-ip-country") || headersList.get("cf-ipcountry"),
  ).trim()
  const location = [city, country].filter(Boolean).join(", ").slice(0, 200) || null
  return {
    ipAddress,
    location,
    userAgent: headersList.get("user-agent")?.slice(0, 500) ?? null,
  }
}

