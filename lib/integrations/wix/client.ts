import { getWixConfig } from "@/lib/integrations/wix/config"

export class WixApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = "WixApiError"
  }
}

export async function wixRequest<T = unknown>(
  method: string,
  path: string,
  options?: { body?: unknown },
): Promise<T> {
  const config = getWixConfig()
  if (!config) throw new Error("Wix API is not configured (WIX_API_KEY, WIX_SITE_ID).")

  const url = path.startsWith("http")
    ? path
    : `https://www.wixapis.com${path.startsWith("/") ? path : `/${path}`}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      "wix-site-id": config.siteId,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text) as unknown
    } catch {
      json = text
    }
  }

  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "message" in json
        ? String((json as { message: string }).message)
        : typeof json === "object" && json && "details" in json
          ? String((json as { details: string }).details)
          : res.statusText || text || "Wix API request failed"
    throw new WixApiError(msg, res.status, json)
  }

  return json as T
}
