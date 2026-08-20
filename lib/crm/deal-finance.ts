const DAY_MS = 24 * 60 * 60 * 1000

export function daysOverdue(dueDate: string, now = new Date()): number {
  const dueTime = new Date(`${dueDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(dueTime)) return 0
  return Math.max(0, Math.floor((now.getTime() - dueTime) / DAY_MS))
}

export function paymentReminderIsDue(input: {
  reminderCount: number
  lastReminderAt: string | null
  now?: Date
}): boolean {
  if (input.reminderCount >= 5) return false
  if (!input.lastReminderAt) return true
  const last = new Date(input.lastReminderAt).getTime()
  if (!Number.isFinite(last)) return true
  return (input.now ?? new Date()).getTime() - last >= 7 * DAY_MS
}

export function cancellationEligibleDate(dueDate: string): string {
  const dueTime = new Date(`${dueDate}T00:00:00.000Z`).getTime()
  return new Date(dueTime + 28 * DAY_MS).toISOString().slice(0, 10)
}

