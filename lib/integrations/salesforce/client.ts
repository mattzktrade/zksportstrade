import { getSalesforceAccessToken } from "@/lib/integrations/salesforce/auth"
import { getSalesforceConfig } from "@/lib/integrations/salesforce/config"

export class SalesforceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = "SalesforceApiError"
  }
}

export async function salesforceRequest<T = unknown>(
  method: string,
  path: string,
  options?: { body?: Record<string, unknown>; instanceUrl?: string },
): Promise<T> {
  const { accessToken, instanceUrl: tokenInstance } = await getSalesforceAccessToken()
  const config = getSalesforceConfig(options?.instanceUrl ?? tokenInstance)
  if (!config) throw new Error("Salesforce is not configured.")

  const base = (options?.instanceUrl ?? tokenInstance).replace(/\/$/, "")
  const url = path.startsWith("http")
    ? path
    : `${base}/services/data/${config.apiVersion}${path.startsWith("/") ? path : `/${path}`}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
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
    const arr = Array.isArray(json) ? json : null
    const first = arr?.[0] as { message?: string } | undefined
    const msg = first?.message ?? (typeof json === "object" && json && "message" in json ? String((json as { message: string }).message) : res.statusText)
    throw new SalesforceApiError(msg, res.status, json)
  }

  return json as T
}

export async function salesforceQuery<T extends Record<string, unknown>>(
  soql: string,
): Promise<T[]> {
  const encoded = encodeURIComponent(soql.replace(/\s+/g, " ").trim())
  const result = await salesforceRequest<{ records: T[]; done: boolean }>("GET", `/query?q=${encoded}`)
  return result.records ?? []
}
