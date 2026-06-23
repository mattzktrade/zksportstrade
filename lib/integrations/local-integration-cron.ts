import { runIntegrationCronJob } from "@/lib/integrations/run-integration-cron"

const DEFAULT_LOCAL_INTERVAL_SEC = 60

type GlobalCron = typeof globalThis & {
  __zkLocalIntegrationCronStarted?: boolean
  __zkLocalIntegrationCronTimer?: ReturnType<typeof setInterval>
}

function intervalMs(): number {
  const raw = Number(process.env.LOCAL_CRON_INTERVAL_SEC ?? DEFAULT_LOCAL_INTERVAL_SEC)
  if (!Number.isFinite(raw) || raw < 15) return DEFAULT_LOCAL_INTERVAL_SEC * 1000
  return Math.floor(raw) * 1000
}

let running = false

async function tick(): Promise<void> {
  if (running) {
    console.log("[local-cron] Previous tick still running — skipping.")
    return
  }
  running = true
  const started = Date.now()
  try {
    const result = await runIntegrationCronJob()
    const applied = result.salesforceInventory.closedWon?.lineItemsApplied ?? 0
    const adjusted = result.salesforceInventory.adjusted
    const drained = result.completed
    const parts = [`${drained} sync job(s)`]
    if (applied > 0) parts.push(`${applied} offline sale(s)`)
    if (adjusted > 0) parts.push(`${adjusted} inventory adjust(s)`)
    console.log(
      `[local-cron] ${new Date().toISOString()} done in ${Date.now() - started}ms — ${parts.join(", ")}`,
    )
    if (result.salesforceInventory.errors.length > 0) {
      console.warn("[local-cron] pull errors:", result.salesforceInventory.errors[0])
    }
    if (result.failed > 0 && result.failures?.[0]?.error) {
      console.warn("[local-cron] sync errors:", result.failures[0].error)
    }
  } catch (e) {
    console.error("[local-cron] tick failed:", e instanceof Error ? e.message : e)
  } finally {
    running = false
  }
}

/** Start automatic integration cron in local development (same work as production Vercel cron). */
export function startLocalIntegrationCron(): void {
  const g = globalThis as GlobalCron
  if (g.__zkLocalIntegrationCronStarted) return
  g.__zkLocalIntegrationCronStarted = true

  const ms = intervalMs()
  console.log(
    `[local-cron] Automatic sync enabled — every ${ms / 1000}s (offline SF sales, holds, outbox).`,
  )
  console.log("[local-cron] Set LOCAL_CRON_INTERVAL_SEC in .env.local to change the interval.")

  const initialDelayMs = 10_000
  setTimeout(() => {
    void tick()
    g.__zkLocalIntegrationCronTimer = setInterval(() => {
      void tick()
    }, ms)
  }, initialDelayMs)
}

/** HTTP poller for a separate terminal when `next dev` is already running. */
export async function runLocalIntegrationCronHttp(options?: {
  baseUrl?: string
  initialDelayMs?: number
}): Promise<void> {
  const baseUrl = (
    options?.baseUrl ??
    process.env.LOCAL_CRON_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    console.error("[local-cron] CRON_SECRET is not set in .env.local")
    process.exit(1)
  }

  const ms = intervalMs()
  const initialDelayMs = options?.initialDelayMs ?? 5_000

  async function httpTick(): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/api/cron/integration-outbox`, {
        headers: { Authorization: `Bearer ${secret}` },
      })
      const body = await res.json().catch(() => ({}))
      const applied = body?.salesforceInventory?.closedWon?.lineItemsApplied ?? 0
      console.log(
        `[local-cron] ${new Date().toISOString()} HTTP ${res.status}` +
          (applied ? ` — ${applied} offline sale(s) applied` : ""),
      )
      if (!res.ok) {
        console.warn("[local-cron] response:", JSON.stringify(body).slice(0, 400))
      }
    } catch (e) {
      console.error("[local-cron] HTTP tick failed:", e instanceof Error ? e.message : e)
    }
  }

  console.log(`[local-cron] HTTP poller → ${baseUrl}/api/cron/integration-outbox every ${ms / 1000}s`)
  await new Promise((r) => setTimeout(r, initialDelayMs))
  await httpTick()
  setInterval(() => {
    void httpTick()
  }, ms)
}
