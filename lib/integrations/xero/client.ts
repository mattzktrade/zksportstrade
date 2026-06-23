import { getXeroAccessToken } from "@/lib/integrations/xero/auth"
import { formatXeroApiErrorBody } from "@/lib/integrations/xero/format-error"

export class XeroApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = "XeroApiError"
  }
}

export async function xeroRequest<T = unknown>(
  method: string,
  path: string,
  options?: { body?: unknown },
): Promise<T> {
  const { accessToken, tenantId } = await getXeroAccessToken()
  const url = path.startsWith("http") ? path : `https://api.xero.com${path.startsWith("/") ? path : `/${path}`}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
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
    const fallback =
      typeof json === "object" && json && "Message" in json
        ? String((json as { Message: string }).Message)
        : typeof json === "object" && json && "Detail" in json
          ? String((json as { Detail: string }).Detail)
          : res.statusText
    const msg = formatXeroApiErrorBody(json, fallback)
    throw new XeroApiError(msg, res.status, json)
  }

  return json as T
}

/** Download invoice PDF (use Accept: application/pdf, not JSON). */
export async function xeroFetchInvoicePdf(invoiceId: string): Promise<ArrayBuffer> {
  const { accessToken, tenantId } = await getXeroAccessToken()
  const url = `https://api.xero.com/api.xro/2.0/Invoices/${encodeURIComponent(invoiceId)}`

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/pdf",
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new XeroApiError(
      text || res.statusText || "Failed to download invoice PDF.",
      res.status,
      text,
    )
  }

  return res.arrayBuffer()
}
