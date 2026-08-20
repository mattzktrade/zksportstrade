import { createAdminClient } from "@/lib/supabase/admin"
import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { generateSigningToken } from "@/lib/booking-forms/snapshot"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import { sendNativeBookingFormReminder } from "@/lib/email/send-booking-form"
import { packageIdsForInventoryChannelSync } from "@/lib/integrations/inventory-sync-packages"
import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { scheduleOutboxDrain } from "@/lib/integrations/schedule-drain"

export type NativeBookingFormAutomationResult = {
  expired: number
  remindersSent: number
  reminderFailures: number
  packagesSynced: string[]
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

export async function processNativeBookingForms(): Promise<NativeBookingFormAutomationResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { expired: 0, remindersSent: 0, reminderFailures: 0, packagesSynced: [] }
  }
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

  const sixthDay = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
  const thirdDay = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data: activeForms, error: activeError } = await admin
    .from("booking_forms")
    .select(
      "id, sent_at, reminder_count, client_token_hash, client_token_expires_at, snapshot_data",
    )
    .in("status", ["sent", "viewed"])
    .lt("client_token_expires_at", new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString())
    .order("sent_at")
  if (activeError) throw new Error(activeError.message)

  let remindersSent = 0
  let reminderFailures = 0
  for (const form of activeForms ?? []) {
    if (!form.sent_at) continue
    const count = Number(form.reminder_count ?? 0)
    const due = (count === 0 && form.sent_at <= thirdDay) || (count === 1 && form.sent_at <= sixthDay)
    if (!due || count >= 2) continue
    const snapshot = form.snapshot_data as BookingFormSnapshot
    const { token, tokenHash } = generateSigningToken()
    const { error: rotateError } = await admin
      .from("booking_forms")
      .update({ client_token_hash: tokenHash })
      .eq("id", form.id)
      .in("status", ["sent", "viewed"])
    if (rotateError) {
      reminderFailures += 1
      continue
    }
    const email = await sendNativeBookingFormReminder({
      recipientEmail: snapshot.billTo.contactEmail,
      recipientName: snapshot.billTo.contactName,
      accountName: snapshot.billTo.accountName,
      documentRef: snapshot.documentRef,
      eventName: snapshot.deal.title,
      totalLabel: totalLabel(snapshot),
      signingUrl: `${getServerSiteOrigin()}/sign/booking/${encodeURIComponent(token)}`,
      expiresAt: form.client_token_expires_at,
    })
    if (!email.ok) {
      reminderFailures += 1
      await admin
        .from("booking_forms")
        .update({
          client_token_hash: form.client_token_hash,
          last_error: email.error ?? email.skipped ?? "Reminder email failed.",
        })
        .eq("id", form.id)
      continue
    }
    remindersSent += 1
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
  }

  return {
    expired: Number(expiredCount ?? 0),
    remindersSent,
    reminderFailures,
    packagesSynced: [...packagesToSync],
  }
}

