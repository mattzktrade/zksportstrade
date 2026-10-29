import { callOutcomeConnected, type EnquiryCallAttempt, type EnquiryCallSummary } from "@/lib/crm/call-outcomes"
import { DEFAULT_LEAD_TIMEZONE, localDayAt, nextContactWindowTime } from "@/lib/crm/lead-timezone"

/** In conversation → Deciding this long after the first conversation. */
export const FOLLOW_UP_AFTER_CONTACT_MS = 24 * 60 * 60 * 1000

/** Reminder hour, Dubai time, for the second and third reminders. */
export const FOLLOW_UP_REMINDER_HOUR = 10

/** Day 1, day 3 and day 7; nothing after the third. */
export const FOLLOW_UP_MAX_REMINDERS = 3

/** A Deciding lead closes this long after the last reminder if nobody has spoken to them since. */
export const FOLLOW_UP_CLOSE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export const FOLLOW_UP_NEXT_ACTION = "Follow up"

export const FOLLOW_UP_CLOSED_SUMMARY = "Closed as Not interested: no response 7 days after the last follow-up"

export function latestConnectedCall(summary: EnquiryCallSummary | undefined): EnquiryCallAttempt | null {
  return summary?.history.find((row) => callOutcomeConnected(row.outcome)) ?? null
}

export function firstConnectedCall(summary: EnquiryCallSummary | undefined): EnquiryCallAttempt | null {
  const connected = summary?.history.filter((row) => callOutcomeConnected(row.outcome)) ?? []
  return connected[connected.length - 1] ?? null
}

function times(values: Array<string | null | undefined>): number[] {
  return values.map((value) => (value ? Date.parse(value) : Number.NaN)).filter((value) => Number.isFinite(value))
}

export function earliestTime(...values: Array<string | null | undefined>): string | null {
  const found = times(values)
  return found.length ? new Date(Math.min(...found)).toISOString() : null
}

export function latestTime(...values: Array<string | null | undefined>): string | null {
  const found = times(values)
  return found.length ? new Date(Math.max(...found)).toISOString() : null
}

/**
 * In conversation → Deciding once a day has passed since the first
 * conversation and any callback staff booked has also passed.
 */
export function followUpMoveDue(input: {
  conversationAt: string | null
  nextActionDueAt: string | null
  now: Date
}): boolean {
  const conversation = input.conversationAt ? Date.parse(input.conversationAt) : Number.NaN
  if (!Number.isFinite(conversation)) return false
  if (input.now.getTime() - conversation < FOLLOW_UP_AFTER_CONTACT_MS) return false
  const due = input.nextActionDueAt ? Date.parse(input.nextActionDueAt) : Number.NaN
  return !Number.isFinite(due) || due <= input.now.getTime()
}

/** First reminder goes out when the lead lands in Deciding, inside 9:00–20:00 Dubai. */
export function firstFollowUpReminderAt(now: Date): Date {
  return nextContactWindowTime(now, DEFAULT_LEAD_TIMEZONE)
}

/** Second reminder two days after the first (day 3), third four days after that (day 7). */
export function nextFollowUpReminderAt(remindersSent: number, lastReminderAt: Date): Date {
  const gapDays = remindersSent <= 1 ? 2 : 4
  return localDayAt(lastReminderAt, DEFAULT_LEAD_TIMEZONE, gapDays, FOLLOW_UP_REMINDER_HOUR)
}

function followUpOverdue(nextActionDueAt: string | null, now: Date): boolean {
  const due = nextActionDueAt ? Date.parse(nextActionDueAt) : Number.NaN
  return Number.isFinite(due) && due <= now.getTime()
}

/**
 * Overdue follow-up, fewer than three reminders since the latest conversation, and the next one is due.
 * After a call or reply the cycle restarts, with the first reminder a day later.
 */
export function followUpReminderDue(input: {
  nextActionDueAt: string | null
  remindersSent: number
  lastReminderAt: string | null
  lastConversationAt?: string | null
  now: Date
}): boolean {
  if (!followUpOverdue(input.nextActionDueAt, input.now)) return false
  if (input.remindersSent >= FOLLOW_UP_MAX_REMINDERS) return false
  if (input.remindersSent === 0 || !input.lastReminderAt) {
    const spoke = input.lastConversationAt ? Date.parse(input.lastConversationAt) : Number.NaN
    return !Number.isFinite(spoke) || input.now.getTime() - spoke >= FOLLOW_UP_AFTER_CONTACT_MS
  }
  const last = new Date(input.lastReminderAt)
  if (Number.isNaN(last.getTime())) return true
  return nextFollowUpReminderAt(input.remindersSent, last).getTime() <= input.now.getTime()
}

/** All three reminders went out since the latest conversation and a week has passed since the last. */
export function followUpAutoCloseDue(input: {
  nextActionDueAt: string | null
  remindersSent: number
  lastReminderAt: string | null
  now: Date
}): boolean {
  if (input.remindersSent < FOLLOW_UP_MAX_REMINDERS) return false
  if (input.nextActionDueAt && !followUpOverdue(input.nextActionDueAt, input.now)) return false
  const last = input.lastReminderAt ? Date.parse(input.lastReminderAt) : Number.NaN
  if (!Number.isFinite(last)) return false
  return input.now.getTime() - last >= FOLLOW_UP_CLOSE_AFTER_MS
}
