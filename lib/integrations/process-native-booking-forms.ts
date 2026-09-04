import { createAdminClient } from "@/lib/supabase/admin"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import {
  BOOKING_FORM_FINAL_REMINDER_EVENT,
  BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT,
  BOOKING_FORM_HOLD_RELEASED_NOTICE_LOOKBACK_MS,
  dueUnsignedBookingFormMail,
  shouldSendHoldReleasedNotice,
} from "@/lib/booking-forms/automation"
import { generateSigningToken } from "@/lib/booking-forms/snapshot"
import {
  readBookingFormSigningToken,
  saveBookingFormSigningToken,
} from "@/lib/booking-forms/signing-token"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import {
  sendNativeBookingFormFinalReminder,
  sendNativeBookingFormHoldReleased,
  sendNativeBookingFormReminder,
} from "@/lib/email/send-booking-form"
import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"

export type NativeBookingFormAutomationResult = {
  expired: number
  remindersSent: number
  reminderFailures: number
  finalRemindersSent: number
  finalReminderFailures: number
  holdReleasedNoticesSent: number
  holdReleasedNoticeFailures: number
  packagesSynced: string[]
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

function emptyResult(): NativeBookingFormAutomationResult {
  return {
    expired: 0,
    remindersSent: 0,
    reminderFailures: 0,
    finalRemindersSent: 0,
    finalReminderFailures: 0,
    holdReleasedNoticesSent: 0,
    holdReleasedNoticeFailures: 0,
    packagesSynced: [],
  }
}

function totalLabel(snapshot: BookingFormSnapshot): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: snapshot.currency,
    }).format(snapshot.total)
  } catch {
    return `${snapshot.currency} ${snapshot.total.toFixed(2)}`
  }
}

function asBookingFormSnapshot(value: unknown): BookingFormSnapshot | null {
  if (!value || typeof value !== "object") return null
  const snapshot = value as BookingFormSnapshot
  const email = snapshot.billTo?.contactEmail?.trim()
  if (!email || !snapshot.documentRef) return null
  return snapshot
}

function signingUrl(token: string): string {
  return `${getServerSiteOrigin()}/sign/booking/${encodeURIComponent(token)}`
}

function emailFields(snapshot: BookingFormSnapshot) {
  return {
    recipientEmail: snapshot.billTo.contactEmail,
    recipientName: snapshot.billTo.contactName,
    accountName: snapshot.billTo.accountName,
    documentRef: snapshot.documentRef,
    eventName: snapshot.deal.title,
    totalLabel: totalLabel(snapshot),
  }
}

export async function processNativeBookingForms(): Promise<NativeBookingFormAutomationResult> {
  const admin = createAdminClient()
  if (!admin) return emptyResult()
  const now = new Date()
  const { data: expiringForms, error: expiringError } = await admin
    .from("booking_forms")
    .select("deal_id")
    .in("status", ["sent", "viewed"])
    .lte("client_token_expires_at", now.toISOString())
  if (expiringError) throw new Error(expiringError.message)

  const expiringDealIds = [...new Set((expiringForms ?? []).map((row) => String(row.deal_id)))]
  const { data: dueReservations, error: reservationError } = expiringDealIds.length
    ? await admin
        .from("inventory_reservations")
        .select("package_id")
        .in("deal_id", expiringDealIds)
        .eq("status", "active")
    : { data: [], error: null }
  if (reservationError) throw new Error(reservationError.message)

  const { data: expiredCount, error: expireError } = await admin.rpc(
    "expire_due_native_booking_forms",
  )
  if (expireError) throw new Error(expireError.message)

  const packagesToSync = new Set<string>()
  for (const row of dueReservations ?? []) {
    for (const packageId of await packageIdsForInventoryChannelSync(admin, String(row.package_id))) {
      packagesToSync.add(packageId)
    }
  }
  for (const packageId of packagesToSync) {
    const queued = await enqueuePackageInventoryChannelSyncServer(packageId, {
      trigger: "booking_form_expired",
      scheduleDrain: false,
    })
    if (!queued.ok) {
      console.warn(`[booking-forms] inventory sync not queued for ${packageId}:`, queued.message)
    }
  }
  if (packagesToSync.size) scheduleOutboxDrain({ maxRounds: 10 })

  const holdReleased = await sendHoldReleasedNotices(admin, now)
  const reminders = await sendUnsignedReminders(admin, now)

  return {
    expired: Number(expiredCount ?? 0),
    remindersSent: reminders.remindersSent,
    reminderFailures: reminders.reminderFailures,
    finalRemindersSent: reminders.finalRemindersSent,
    finalReminderFailures: reminders.finalReminderFailures,
    holdReleasedNoticesSent: holdReleased.sent,
    holdReleasedNoticeFailures: holdReleased.failures,
    packagesSynced: [...packagesToSync],
  }
}

async function sendHoldReleasedNotices(
  admin: AdminClient,
  now: Date,
): Promise<{ sent: number; failures: number }> {
  const lookback = new Date(now.getTime() - BOOKING_FORM_HOLD_RELEASED_NOTICE_LOOKBACK_MS).toISOString()
  const { data: expiredForms, error: expiredError } = await admin
    .from("booking_forms")
    .select("id, status, expired_at, snapshot_data")
    .eq("status", "expired")
    .gte("expired_at", lookback)
  if (expiredError) throw new Error(expiredError.message)

  const candidates = expiredForms ?? []
  if (!candidates.length) return { sent: 0, failures: 0 }

  const { data: noticeEvents, error: noticeError } = await admin
    .from("booking_form_events")
    .select("booking_form_id")
    .eq("event_type", BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT)
    .in(
      "booking_form_id",
      candidates.map((row) => row.id),
    )
  if (noticeError) throw new Error(noticeError.message)

  const alreadyNotified = new Set(
    (noticeEvents ?? []).map((row) => String(row.booking_form_id)),
  )

  let sent = 0
  let failures = 0
  for (const form of candidates) {
    if (
      !shouldSendHoldReleasedNotice({
        now,
        status: String(form.status),
        expiredAt: form.expired_at,
        alreadyNotified: alreadyNotified.has(String(form.id)),
      })
    ) {
      continue
    }
    const snapshot = asBookingFormSnapshot(form.snapshot_data)
    if (!snapshot) {
      failures += 1
      await admin
        .from("booking_forms")
        .update({ last_error: "Hold-released notice skipped: booking form snapshot is incomplete." })
        .eq("id", form.id)
      continue
    }
    const email = await sendNativeBookingFormHoldReleased(emailFields(snapshot))
    if (!email.ok) {
      failures += 1
      await admin
        .from("booking_forms")
        .update({ last_error: email.error ?? email.skipped ?? "Hold-released notice failed." })
        .eq("id", form.id)
      continue
    }
    sent += 1
    alreadyNotified.add(String(form.id))
    await admin.from("booking_forms").update({ last_error: null }).eq("id", form.id)
    await admin.from("booking_form_events").insert({
      booking_form_id: form.id,
      event_type: BOOKING_FORM_HOLD_RELEASED_NOTICE_EVENT,
      actor_email: snapshot.billTo.contactEmail,
      metadata: { stock_released: true },
    })
  }
  return { sent, failures }
}

async function sendUnsignedReminders(
  admin: AdminClient,
  now: Date,
): Promise<{
  remindersSent: number
  reminderFailures: number
  finalRemindersSent: number
  finalReminderFailures: number
}> {
  const { data: activeForms, error: activeError } = await admin
    .from("booking_forms")
    .select(
      "id, sent_at, reminder_count, client_token_hash, client_token_expires_at, snapshot_data",
    )
    .in("status", ["sent", "viewed"])
    .lt("client_token_expires_at", new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString())
    .order("sent_at")
  if (activeError) throw new Error(activeError.message)

  let remindersSent = 0
  let reminderFailures = 0
  let finalRemindersSent = 0
  let finalReminderFailures = 0

  for (const form of activeForms ?? []) {
    const kind = dueUnsignedBookingFormMail({
      now,
      sentAt: form.sent_at,
      expiresAt: form.client_token_expires_at,
      reminderCount: Number(form.reminder_count ?? 0),
    })
    if (!kind) continue

    if (kind === "twelve_hour_reminder") {
      const result = await sendTwelveHourReminder(admin, form, now)
      if (result === "sent") remindersSent += 1
      else reminderFailures += 1
      continue
    }

    const result = await sendFinalReminder(admin, form, now)
    if (result === "sent") finalRemindersSent += 1
    else finalReminderFailures += 1
  }

  return {
    remindersSent,
    reminderFailures,
    finalRemindersSent,
    finalReminderFailures,
  }
}

type ReminderForm = {
  id: string
  sent_at: string | null
  reminder_count: number | null
  client_token_hash: string
  client_token_expires_at: string
  snapshot_data: unknown
}

async function sendTwelveHourReminder(
  admin: AdminClient,
  form: ReminderForm,
  now: Date,
): Promise<"sent" | "failed"> {
  const snapshot = asBookingFormSnapshot(form.snapshot_data)
  if (!snapshot) return "failed"
  const count = Number(form.reminder_count ?? 0)
  const previousToken = await readBookingFormSigningToken(admin, form.id)
  const { token, tokenHash } = generateSigningToken()
  const { error: rotateError } = await admin
    .from("booking_forms")
    .update({ client_token_hash: tokenHash })
    .eq("id", form.id)
    .in("status", ["sent", "viewed"])
  if (rotateError) return "failed"
  try {
    await saveBookingFormSigningToken(admin, form.id, token)
  } catch (tokenError) {
    console.warn("[booking-forms] could not store reminder signing token:", tokenError)
  }
  const email = await sendNativeBookingFormReminder({
    ...emailFields(snapshot),
    signingUrl: signingUrl(token),
    expiresAt: form.client_token_expires_at,
  })
  if (!email.ok) {
    await saveBookingFormSigningToken(admin, form.id, previousToken ?? "", {
      client_token_hash: form.client_token_hash,
      last_error: email.error ?? email.skipped ?? "Reminder email failed.",
    })
    return "failed"
  }
  await admin
    .from("booking_forms")
    .update({
      reminder_count: count + 1,
      last_reminder_at: now.toISOString(),
      last_error: null,
    })
    .eq("id", form.id)
  await admin.from("booking_form_events").insert({
    booking_form_id: form.id,
    event_type: "reminder_sent",
    actor_email: snapshot.billTo.contactEmail,
    metadata: { reminder_number: count + 1 },
  })
  return "sent"
}

async function sendFinalReminder(
  admin: AdminClient,
  form: ReminderForm,
  now: Date,
): Promise<"sent" | "failed"> {
  const snapshot = asBookingFormSnapshot(form.snapshot_data)
  if (!snapshot) return "failed"

  let token = await readBookingFormSigningToken(admin, form.id)
  const previousToken = token
  const previousHash = form.client_token_hash
  let rotated = false
  if (!token) {
    const generated = generateSigningToken()
    const { error: rotateError } = await admin
      .from("booking_forms")
      .update({ client_token_hash: generated.tokenHash })
      .eq("id", form.id)
      .in("status", ["sent", "viewed"])
    if (rotateError) return "failed"
    rotated = true
    token = generated.token
    try {
      await saveBookingFormSigningToken(admin, form.id, token)
    } catch (tokenError) {
      console.warn("[booking-forms] could not store final-reminder signing token:", tokenError)
    }
  }

  const email = await sendNativeBookingFormFinalReminder({
    ...emailFields(snapshot),
    signingUrl: signingUrl(token),
    expiresAt: form.client_token_expires_at,
  })
  if (!email.ok) {
    if (rotated) {
      await saveBookingFormSigningToken(admin, form.id, previousToken ?? "", {
        client_token_hash: previousHash,
        last_error: email.error ?? email.skipped ?? "Final reminder email failed.",
      })
    } else {
      await admin
        .from("booking_forms")
        .update({
          last_error: email.error ?? email.skipped ?? "Final reminder email failed.",
        })
        .eq("id", form.id)
    }
    return "failed"
  }

  await admin
    .from("booking_forms")
    .update({
      reminder_count: 2,
      last_reminder_at: now.toISOString(),
      last_error: null,
    })
    .eq("id", form.id)
  await admin.from("booking_form_events").insert({
    booking_form_id: form.id,
    event_type: BOOKING_FORM_FINAL_REMINDER_EVENT,
    actor_email: snapshot.billTo.contactEmail,
    metadata: { reminder_number: 2, hours_before_expiry: 1 },
  })
  return "sent"
}
