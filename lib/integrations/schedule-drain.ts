import { after } from "next/server"
import { drainIntegrationOutbox, type DrainOutboxOptions } from "@/lib/integrations/drain-outbox"

function runDrain(options: DrainOutboxOptions): void {
  void drainIntegrationOutbox(options).catch((e) => {
    console.error("[integrations] background outbox drain failed:", e instanceof Error ? e.message : e)
  })
}

/**
 * Run outbox processing in the background after the HTTP response (checkout, admin saves, etc.).
 * Falls back to fire-and-forget if `after()` is unavailable.
 */
export function scheduleOutboxDrain(options: DrainOutboxOptions = {}): void {
  try {
    after(() => {
      return drainIntegrationOutbox(options)
    })
  } catch {
    runDrain(options)
  }
}

/** Await drain inline (webhooks, explicit admin "retry" flows). */
export async function drainOutboxNow(options: DrainOutboxOptions = {}) {
  return drainIntegrationOutbox(options)
}
