import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  BOOKING_FORM_FINAL_REMINDER_EVENT,
  BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT,
  dueUnsignedBookingFormMail,
  shouldSendHoldReleasedNotice,
} from "../lib/booking-forms/automation"

const sentAt = "2026-09-04T00:00:00.000Z"
const expiresAt = "2026-09-05T00:00:00.000Z"

test("unsigned booking form mail is due at 12 hours, then 1 hour before expiry", () => {
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T11:59:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 0,
    }),
    null,
  )
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T12:00:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 0,
    }),
    "twelve_hour_reminder",
  )
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T12:00:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 1,
    }),
    null,
  )
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T23:00:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 1,
    }),
    "final_reminder",
  )
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T23:00:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 2,
    }),
    null,
  )
})

test("final reminder wins if the 12-hour reminder was never sent and expiry is within an hour", () => {
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T23:30:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 0,
    }),
    "final_reminder",
  )
})

test("unsigned follow-up mail is not due after the form has expired", () => {
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-05T00:00:00.000Z"),
      sentAt,
      expiresAt,
      reminderCount: 1,
    }),
    null,
  )
  assert.equal(
    dueUnsignedBookingFormMail({
      now: new Date("2026-09-04T12:00:00.000Z"),
      sentAt: null,
      expiresAt,
      reminderCount: 0,
    }),
    null,
  )
})

test("hold-released notice is sent once for a recently expired unsigned form", () => {
  const now = new Date("2026-09-05T00:10:00.000Z")
  assert.equal(
    shouldSendHoldReleasedNotice({
      now,
      status: "expired",
      expiredAt: "2026-09-05T00:00:00.000Z",
      alreadyNotified: false,
    }),
    true,
  )
  assert.equal(
    shouldSendHoldReleasedNotice({
      now,
      status: "expired",
      expiredAt: "2026-09-05T00:00:00.000Z",
      alreadyNotified: true,
    }),
    false,
  )
  assert.equal(
    shouldSendHoldReleasedNotice({
      now,
      status: "expired",
      expiredAt: "2026-09-04T12:00:00.000Z",
      alreadyNotified: false,
    }),
    false,
  )
  assert.equal(
    shouldSendHoldReleasedNotice({
      now,
      status: "completed",
      expiredAt: "2026-09-05T00:00:00.000Z",
      alreadyNotified: false,
    }),
    false,
  )
})

test("booking form automation cron still expires first, then sends both new emails", () => {
  const processor = readFileSync("lib/integrations/process-native-booking-forms.ts", "utf8")
  const processFn = processor.slice(processor.indexOf("export async function processNativeBookingForms"))
  const expireAt = processFn.indexOf("expire_due_native_booking_forms")
  const holdNoticeAt = processFn.indexOf("sendHoldReleasedNotices")
  const remindersAt = processFn.indexOf("sendUnsignedReminders")
  assert.ok(expireAt > 0)
  assert.ok(holdNoticeAt > expireAt)
  assert.ok(remindersAt > holdNoticeAt)
  assert.match(processor, /dueUnsignedBookingFormMail/)
  assert.match(processor, /reminder_count: 2/)
  assert.match(processor, /sendNativeBookingFormFinalReminder/)
  assert.match(processor, /sendNativeBookingFormHoldReleased/)
  const twelveHourFn = processor.slice(
    processor.indexOf("async function sendTwelveHourReminder"),
    processor.indexOf("async function sendFinalReminder"),
  )
  const finalFn = processor.slice(processor.indexOf("async function sendFinalReminder"))
  assert.match(twelveHourFn, /generateSigningToken\(\)/)
  assert.match(finalFn, /readBookingFormSigningToken/)
  assert.equal(BOOKING_FORM_FINAL_REMINDER_EVENT, "final_reminder_sent")
  assert.equal(BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT, "hold_released_notice_sent")
})
