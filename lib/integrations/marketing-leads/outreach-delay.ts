import { isInsideContactWindow, nextContactWindowTime, timezoneForPhone } from "@/lib/crm/lead-timezone"

export type OutreachDelayStep = {
  delay_hours: number
  delay_minutes: number
}

export function normalizeOutreachDelay(step: {
  delay_hours?: number | null
  delay_minutes?: number | null
} | null | undefined): OutreachDelayStep {
  const hours = Number(step?.delay_hours)
  const minutes = Number(step?.delay_minutes)
  return {
    delay_hours: Number.isFinite(hours) ? Math.max(0, Math.min(24 * 30, Math.floor(hours))) : 0,
    delay_minutes: Number.isFinite(minutes) ? Math.max(0, Math.min(59, Math.floor(minutes))) : 0,
  }
}

export function outreachDelayMs(step: OutreachDelayStep | null | undefined): number {
  const delay = normalizeOutreachDelay(step)
  return (delay.delay_hours * 60 + delay.delay_minutes) * 60 * 1000
}

export function outreachDueAt(step: OutreachDelayStep | null | undefined, now: Date): string {
  return new Date(now.getTime() + outreachDelayMs(step)).toISOString()
}

/**
 * Stage 1 always goes straight away. Later stages wait for 9:00–20:00 in the
 * lead's local time. Returns when to retry, or null when it can send now.
 */
export function outreachSendWindowStart(
  stage: number,
  phone: string | null | undefined,
  now: Date,
): Date | null {
  if (stage <= 1) return null
  const zone = timezoneForPhone(phone)
  if (isInsideContactWindow(now, zone)) return null
  return nextContactWindowTime(now, zone)
}
