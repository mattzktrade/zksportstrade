/**
 * Integration cron loop outside `next dev` so Turbopack never serves a stale module graph
 * that still double-counts offline Salesforce sales (−8 inventory per tick).
 */
import { config } from "dotenv"
import { resolve } from "node:path"
config({ path: resolve(process.cwd(), ".env.local") })

const DEFAULT_INTERVAL_SEC = 60

function intervalMs(): number {
  const raw = Number(process.env.LOCAL_CRON_INTERVAL_SEC ?? DEFAULT_INTERVAL_SEC)
  if (!Number.isFinite(raw) || raw < 15) return DEFAULT_INTERVAL_SEC * 1000
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
    const { runIntegrationCronJob } = await import("../lib/integrations/run-integration-cron")
    const result = await runIntegrationCronJob()
    const applied = result.salesforceInventory.closedWon?.lineItemsApplied ?? 0
    const adjusted = result.salesforceInventory.adjusted
    const healed = result.linkedInventoryHeal?.packagesFixed ?? 0
    const drained = result.completed
    const parts = [`${drained} sync job(s)`]
    if (applied > 0) parts.push(`${applied} offline sale(s)`)
    if (adjusted > 0) parts.push(`${adjusted} inventory adjust(s)`)
    if (healed > 0) parts.push(`${healed} linked heal(s)`)
    console.log(
      `[local-cron] ${new Date().toISOString()} done in ${Date.now() - started}ms — ${parts.join(", ")}`,
    )
  } catch (e) {
    console.error("[local-cron] tick failed:", e instanceof Error ? e.message : e)
  } finally {
    running = false
  }
}

const ms = intervalMs()
console.log(`[local-cron] External scheduler — every ${ms / 1000}s (fresh tsx import, not Next bundle).`)

const initialDelayMs = 10_000
setTimeout(() => {
  void tick()
  setInterval(() => {
    void tick()
  }, ms)
}, initialDelayMs)
