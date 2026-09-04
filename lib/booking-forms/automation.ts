/** Timing for unsigned booking-form follow-up emails. Hold length is 24 hours from send. */

export const BOOKING_FORM_TWELVE_HOUR_REMINDER_MS = 12 * 60 * 60 * 1000
export const BOOKING_FORM_FINAL_REMINDER_MS = 60 * 60 * 1000
export const BOOKING_FORM_HOLD_RELEASED_NOTICE_LOOKBACK_MS = 6 * 60 * 60 * 1000

export const BOOKING_FORM_FINAL_REMINDER_EVENT = "final_reminder_sent"
export const BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT = "hold_released_notice_sent"

export type UnsignedBookingFormMail = "twelve_hour_reminder" | "final_reminder"

export function dueUnsignedBookingFormMail(input: {
  now: Date
  sentAt: string | null
  expiresAt: string
  reminderCount: number
}): UnsignedBookingFormMail | null {
  if (!input.sentAt) return null
  const expiresAt = Date.parse(input.expiresAt)
  if (!Number.isFinite(expiresAt)) return null
  const nowMs = input.now.getTime()
  if (expiresAt <= nowMs) return null

  const count = Number(input.reminderCount ?? 0)
  const msUntilExpiry = expiresAt - nowMs
  if (msUntilExpiry <= BOOKING_FORM_FINAL_REMINDER_MS && count < 2) {
    return "final_reminder"
  }

  const sentAt = Date.parse(input.sentAt)
  if (!Number.isFinite(sentAt)) return null
  if (count === 0 && sentAt <= nowMs - BOOKING_FORM_TWELVE_HOUR_REMINDER_MS) {
    return "twelve_hour_reminder"
  }
  return null
}

export function shouldSendHoldReleasedNotice(input: {
  now: Date
  status: string
  expiredAt: string | null
  alreadyNotified: boolean
}): boolean {
  if (input.alreadyNotified) return false
  if (input.status !== "expired") return false
  if (!input.expiredAt) return false
  const expiredAt = Date.parse(input.expiredAt)
  if (!Number.isFinite(expiredAt)) return false
  const nowMs = input.now.getTime()
  if (expiredAt > nowMs) return false
  return nowMs - expiredAt <= BOOKING_FORM_HOLD_RELEASED_NOTICE_LOOKBACK_MS
}
