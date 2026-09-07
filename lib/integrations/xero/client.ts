import { getXeroAccessToken } from "@/lib/integrations/xero/auth"
import { formatXeroApiErrorBody } from "@/lib/integrations/xero/format-error"
import {
  decideXeroInlineRetry,
  isRetryableXeroStatus,
  parseRetryAfterMs,
  sleep,
  XERO_MAX_INLINE_WAIT_MS,
  XERO_RATE_LIMIT_USER_MESSAGE,
} from "@/lib/integrations/xero/rate-limit"
import {
  getXeroRateLimitCooldownUntilMs,
  markXeroRateLimitCooldown,
} from "@/lib/integrations/xero/settings-store"

export class XeroApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = "XeroApiError"
  }
}

let xeroCallMutex: Promise<void> = Promise.resolve()
let lastXeroCallAt = 0
const XERO_MIN_CALL_GAP_MS = 150

async function withXeroCallGate<T>(fn: () => Promise<T>): Promise<T> {
  const prev = xeroCallMutex
  let release!: () => void
  xeroCallMutex = new Promise((resolve) => {
    release = () => resolve()
  })
  await prev
  try {
    await throwIfXeroCooldownBlocks()
    const wait = lastXeroCallAt + XERO_MIN_CALL_GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastXeroCallAt = Date.now()
    return await fn()
  } finally {
    release()
  }
}

async function throwIfXeroCooldownBlocks(): Promise<void> {
  const until = await getXeroRateLimitCooldownUntilMs()
  if (!until) return
  const waitMs = until - Date.now()
  if (waitMs <= 0) return
  if (waitMs <= XERO_MAX_INLINE_WAIT_MS) {
    await sleep(waitMs)
    return
  }
  throw new XeroApiError(XERO_RATE_LIMIT_USER_MESSAGE, 429, null, waitMs)
}

function parseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function errorMessage(json: unknown, fallback: string): string {
  if (typeof json === "object" && json && "Message" in json) {
    return formatXeroApiErrorBody(json, String((json as { Message: string }).Message) || fallback)
  }
  if (typeof json === "object" && json && "Detail" in json) {
    return formatXeroApiErrorBody(json, String((json as { Detail: string }).Detail) || fallback)
  }
  return formatXeroApiErrorBody(json, fallback)
}

async function fetchXeroWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  for (let tryIndex = 0; ; tryIndex++) {
    const res = await fetch(input, init)
    if (!isRetryableXeroStatus(res.status)) return res

    const retryAfterHeader = res.headers.get("Retry-After")
    const decision = decideXeroInlineRetry({
      tryIndex,
      status: res.status,
      retryAfterHeader,
    })
    if (!decision.retry) {
      return res
    }
    await sleep(decision.waitMs)
  }

  throw new Error("Xero retry loop exited unexpectedly.")
}

export async function xeroRequest<T = unknown>(
  method: string,
  path: string,
  options?: { body?: unknown; idempotencyKey?: string },
): Promise<T> {
  return withXeroCallGate(async () => {
    const { accessToken, tenantId } = await getXeroAccessToken()
    const url = path.startsWith("http") ? path : `https://api.xero.com${path.startsWith("/") ? path : `/${path}`}`

    const res = await fetchXeroWithRetry(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    const text = await res.text()
    const json = parseBody(text)

    if (!res.ok) {
      const fallback = res.status === 429 ? XERO_RATE_LIMIT_USER_MESSAGE : res.statusText
      const msg = errorMessage(json, fallback)
      const retryAfterMs = parseRetryAfterOrUndefined(res)
      if (res.status === 429) {
        await markXeroRateLimitCooldown(retryAfterMs)
      }
      throw new XeroApiError(msg, res.status, json, retryAfterMs)
    }

    return json as T
  })
}

/** Download invoice PDF (use Accept: application/pdf, not JSON). */
export async function xeroFetchInvoicePdf(invoiceId: string): Promise<ArrayBuffer> {
  return withXeroCallGate(async () => {
    const { accessToken, tenantId } = await getXeroAccessToken()
    const url = `https://api.xero.com/api.xro/2.0/Invoices/${encodeURIComponent(invoiceId)}`

    const res = await fetchXeroWithRetry(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": tenantId,
        Accept: "application/pdf",
      },
    })

    if (!res.ok) {
      const text = await res.text()
      const retryAfterMs = parseRetryAfterOrUndefined(res)
      if (res.status === 429) {
        await markXeroRateLimitCooldown(retryAfterMs)
      }
      throw new XeroApiError(
        res.status === 429 ? XERO_RATE_LIMIT_USER_MESSAGE : text || res.statusText || "Failed to download invoice PDF.",
        res.status,
        text,
        retryAfterMs,
      )
    }

    return res.arrayBuffer()
  })
}

function parseRetryAfterOrUndefined(res: Response): number | undefined {
  const parsed = parseRetryAfterMs(res.headers.get("Retry-After"))
  return parsed ?? undefined
}
