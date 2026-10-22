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
