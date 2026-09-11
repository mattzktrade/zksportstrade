import { revalidatePath } from "next/cache"
import {
  bookingDayPlaces,
  desiredGuestsFromForm,
  guestDetailsFormCanSubmit,
  guestDetailsStatusAfterForm,
  parseGuestAttendanceMode,
  planGuestFormUpserts,
  sameGuestQuantity,
  type GuestAttendanceMode,
  type GuestFormPerson,
} from "@/lib/guest-details/model"
import {
  loadGuestDetailsBookingContext,
  loadGuestDetailsInviteByToken,
} from "@/lib/guest-details/invite"
import { getPublicGuestDetailsForm, type PublicGuestDetailsForm } from "@/lib/guest-details/public"
import { missingGuestDetailsSchema, guestDetailsMigrationMessage } from "@/lib/guest-details/schema"
import { headshotBelongsToInvite, normalisedHeadshotPath } from "@/lib/guest-details/storage"
import { syncDealWorkflowFromOperations } from "@/lib/operations/sync-deal-workflow"
import { createAdminClient } from "@/lib/supabase/admin"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

type Result =
  | { ok: true; message: string; form: PublicGuestDetailsForm }
  | { ok: false; message: string }

type ExistingRow = {
  id: string
  full_name: string | null
  is_lead_guest: boolean | null
  headshot_path?: string | null
  attendance_day?: string | null
  sort_order: number | null
  table_number?: string | null
  ticket_number?: string | null
  paddock_tour?: string | null
  email?: string | null
  phone?: string | null
  nationality?: string | null
  date_of_birth?: string | null
  dietary_requirements?: string | null
  special_requests?: string | null
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

function safeUuid(value: string | null | undefined): string | null {
  const id = value?.trim() ?? ""
  return UUID_RE.test(id) ? id : null
}

async function loadExistingGuests(
  admin: Admin,
  table: "order_guests" | "deal_guests",
  parent: "order_id" | "deal_id",
  parentId: string,
): Promise<ExistingRow[]> {
  const full =
    "id, full_name, is_lead_guest, headshot_path, attendance_day, sort_order, table_number, ticket_number, paddock_tour, email, phone, nationality, date_of_birth, dietary_requirements, special_requests"
  const bare =
    "id, full_name, is_lead_guest, headshot_path, attendance_day, sort_order, email, phone, nationality, date_of_birth, dietary_requirements, special_requests"
  const min = "id, full_name, is_lead_guest, sort_order"
  const query = await admin.from(table).select(full).eq(parent, parentId).order("sort_order")
  if (!query.error && query.data) return query.data as ExistingRow[]
  const mid = await admin.from(table).select(bare).eq(parent, parentId).order("sort_order")
  if (!mid.error && mid.data) return mid.data as ExistingRow[]
  const fallback = await admin.from(table).select(min).eq(parent, parentId).order("sort_order")
  return (fallback.data ?? []) as ExistingRow[]
}

async function copyDealGuestsToOrder(admin: Admin, dealId: string, orderId: string): Promise<void> {
  const existingOrder = await loadExistingGuests(admin, "order_guests", "order_id", orderId)
  if (existingOrder.length) return
  const dealGuests = await loadExistingGuests(admin, "deal_guests", "deal_id", dealId)
  if (!dealGuests.length) return
  const now = new Date().toISOString()
  let leadAssigned = false
  const { error } = await admin.from("order_guests").insert(
    dealGuests.map((row) => {
      const isLead = Boolean(row.is_lead_guest) && !leadAssigned
      if (isLead) leadAssigned = true
      return {
      order_id: orderId,
      full_name: row.full_name,
      email: row.email ?? null,
      phone: row.phone ?? null,
      nationality: row.nationality ?? null,
      date_of_birth: row.date_of_birth ?? null,
      dietary_requirements: row.dietary_requirements ?? null,
      special_requests: row.special_requests ?? null,
      is_lead_guest: isLead,
      details_complete: Boolean(blank(row.full_name)),
      sort_order: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
      attendance_day: row.attendance_day ?? null,
      headshot_path: row.headshot_path ?? null,
      table_number: row.table_number ?? null,
      ticket_number: row.ticket_number ?? null,
      paddock_tour: row.paddock_tour ?? null,
      updated_at: now,
      }
    }),
  )
  if (error && !/table_number|ticket_number|paddock_tour|attendance_day|headshot_path/i.test(error.message)) {
    throw new Error(error.message)
  }
  if (error) {
    const { error: retryError } = await admin.from("order_guests").insert(
      dealGuests.map((row) => ({
        order_id: orderId,
        full_name: row.full_name,
        email: row.email ?? null,
        phone: row.phone ?? null,
        nationality: row.nationality ?? null,
        date_of_birth: row.date_of_birth ?? null,
        dietary_requirements: row.dietary_requirements ?? null,
        special_requests: row.special_requests ?? null,
        is_lead_guest: Boolean(row.is_lead_guest),
        details_complete: Boolean(blank(row.full_name)),
        sort_order: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
        updated_at: now,
      })),
    )
    if (retryError) throw new Error(retryError.message)
  }
}

async function writeAttendanceMode(
  admin: Admin,
  target: { orderId: string | null; dealId: string },
  mode: GuestAttendanceMode,
  guestDetailsStatus: string,
  actorProfileId: string | null,
) {
  const now = new Date().toISOString()
  if (target.orderId) {
    const { data: current } = await admin
      .from("order_operations")
      .select("guest_details_status, delivery_status, fulfilment_status, communication_status")
      .eq("order_id", target.orderId)
      .maybeSingle()
    const patch = {
      guest_details_status: guestDetailsStatus,
      guest_attendance_mode: mode,
      updated_at: now,
      updated_by: actorProfileId,
    }
    if (current) {
      const { error } = await admin.from("order_operations").update(patch).eq("order_id", target.orderId)
      if (error && /guest_attendance_mode/i.test(error.message)) {
        const { error: retry } = await admin
          .from("order_operations")
          .update({
            guest_details_status: guestDetailsStatus,
            updated_at: now,
            updated_by: actorProfileId,
          })
          .eq("order_id", target.orderId)
        if (retry) throw new Error(retry.message)
      } else if (error) throw new Error(error.message)
    } else {
      const { error } = await admin.from("order_operations").insert({
        order_id: target.orderId,
        guest_details_status: guestDetailsStatus,
        guest_attendance_mode: mode,
        updated_by: actorProfileId,
      })
      if (error && /guest_attendance_mode/i.test(error.message)) {
        const { error: retry } = await admin.from("order_operations").insert({
          order_id: target.orderId,
          guest_details_status: guestDetailsStatus,
          updated_by: actorProfileId,
        })
        if (retry) throw new Error(retry.message)
      } else if (error) throw new Error(error.message)
    }
    return {
      deliveryStatus: String(current?.delivery_status ?? "not_ready"),
      fulfilmentStatus: String(current?.fulfilment_status ?? "confirmed"),
    }
  }

  const { data: current } = await admin
    .from("deal_operations")
    .select("guest_details_status, fulfilment_status, communication_status, supplier_status, delivery_status")
    .eq("deal_id", target.dealId)
    .maybeSingle()
  const { error } = await admin.from("deal_operations").upsert(
    {
      deal_id: target.dealId,
      fulfilment_status: current?.fulfilment_status ?? "confirmed",
      guest_details_status: guestDetailsStatus,
      communication_status: current?.communication_status ?? "guest_request_sent",
      supplier_status: current?.supplier_status ?? "unassigned",
      delivery_status: current?.delivery_status ?? "not_ready",
      guest_attendance_mode: mode,
      updated_by: actorProfileId,
      updated_at: now,
    },
    { onConflict: "deal_id" },
  )
  if (error && /guest_attendance_mode/i.test(error.message)) {
    const { error: retry } = await admin.from("deal_operations").upsert(
      {
        deal_id: target.dealId,
        fulfilment_status: current?.fulfilment_status ?? "confirmed",
        guest_details_status: guestDetailsStatus,
        communication_status: current?.communication_status ?? "guest_request_sent",
        supplier_status: current?.supplier_status ?? "unassigned",
        delivery_status: current?.delivery_status ?? "not_ready",
        updated_by: actorProfileId,
        updated_at: now,
      },
      { onConflict: "deal_id" },
    )
    if (retry) throw new Error(retry.message)
  } else if (error) throw new Error(error.message)
  return {
    deliveryStatus: String(current?.delivery_status ?? "not_ready"),
    fulfilmentStatus: String(current?.fulfilment_status ?? "confirmed"),
  }
}

export async function savePublicGuestDetailsForm(input: {
  token: string
  submit: boolean
  mode: string
  sameGuests: GuestFormPerson[]
  perDayGuests: Record<string, GuestFormPerson[]>
}): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Guest details form is not configured." }

  try {
    const invite = await loadGuestDetailsInviteByToken(admin, input.token)
    if (!invite?.dealId) return { ok: false, message: "This guest details link is invalid." }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return { ok: false, message: "This guest details form has expired. Contact ZK for a new link." }
    }

    const booking = await loadGuestDetailsBookingContext(admin, invite.dealId)
    if (!booking) return { ok: false, message: "This booking is no longer available." }

    const places = bookingDayPlaces(booking.lines, booking.eventDate)
    const allowSameMode = sameGuestQuantity(places) != null
    const showModePicker = places.length > 1
    let mode: GuestAttendanceMode = parseGuestAttendanceMode(input.mode)
    if (!showModePicker) mode = "same"
    else if (!allowSameMode) mode = "per_day"

    const days = places.map((place) => place.day)
    const formInput = {
      mode,
      sameGuests: input.sameGuests,
      perDayGuests: input.perDayGuests,
      days,
    }
    if (input.submit) {
      const canSubmit = guestDetailsFormCanSubmit(formInput)
      if (!canSubmit.ok) return { ok: false, message: canSubmit.message }
    }

    const desired = desiredGuestsFromForm(formInput).map((row) => {
      const path = row.headshotPath ? normalisedHeadshotPath(row.headshotPath) : null
      return {
        ...row,
        id: safeUuid(row.id),
        headshotPath: path && headshotBelongsToInvite(path, invite.id) ? path : null,
      }
    })

    const orderId = invite.orderId || booking.orderId
    const now = new Date().toISOString()
    const leadDesired = desired.find((row) => row.isLeadGuest && row.fullName)

    if (desired.length > 0) {
      if (orderId) await copyDealGuestsToOrder(admin, booking.dealId, orderId)
      const table = orderId ? "order_guests" : "deal_guests"
      const parent = orderId ? "order_id" : "deal_id"
      const parentId = orderId ?? booking.dealId
      const existing = await loadExistingGuests(admin, table, parent, parentId)
      const plan = planGuestFormUpserts(
        existing.map((row) => ({
          id: row.id,
          attendanceDay: row.attendance_day ?? null,
          sortOrder: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
          fullName: row.full_name,
          tableNumber: row.table_number ?? null,
          ticketNumber: row.ticket_number ?? null,
          paddockTour: row.paddock_tour ?? null,
        })),
        desired,
      )

      const parentPatch = orderId ? { order_id: orderId } : { deal_id: booking.dealId }

    const { error: clearError } = await admin.from(table).update({ is_lead_guest: false, updated_at: now }).eq(parent, parentId)
    if (clearError) throw new Error(clearError.message)

    for (const item of plan.updates) {
      const payload = {
        full_name: item.row.fullName,
        is_lead_guest: false,
        details_complete: Boolean(item.row.fullName),
        sort_order: item.row.sortOrder,
        attendance_day: item.row.attendanceDay,
        headshot_path: item.row.headshotPath,
        updated_at: now,
      }
      const { error } = await admin.from(table).update(payload).eq("id", item.id).eq(parent, parentId)
      if (error && /attendance_day|headshot_path/i.test(error.message)) {
        const { error: retry } = await admin
          .from(table)
          .update({
            full_name: item.row.fullName,
            is_lead_guest: false,
            details_complete: Boolean(item.row.fullName),
            sort_order: item.row.sortOrder,
            updated_at: now,
          })
          .eq("id", item.id)
          .eq(parent, parentId)
        if (retry) throw new Error(retry.message)
      } else if (error) throw new Error(error.message)
    }

    const inserted: Array<{ id: string; attendance_day: string | null; sort_order: number }> = []
    if (plan.inserts.length) {
      const rows = plan.inserts.map((row) => ({
        ...parentPatch,
        full_name: row.fullName,
        is_lead_guest: false,
        details_complete: Boolean(row.fullName),
        sort_order: row.sortOrder,
        attendance_day: row.attendanceDay,
        headshot_path: row.headshotPath,
        updated_at: now,
      }))
      const insertedResult = await admin.from(table).insert(rows).select("id, attendance_day, sort_order")
      if (insertedResult.error && /attendance_day|headshot_path/i.test(insertedResult.error.message)) {
        const retry = await admin
          .from(table)
          .insert(
            plan.inserts.map((row) => ({
              ...parentPatch,
              full_name: row.fullName,
              is_lead_guest: false,
              details_complete: Boolean(row.fullName),
              sort_order: row.sortOrder,
              updated_at: now,
            })),
          )
          .select("id, sort_order")
        if (retry.error) throw new Error(retry.error.message)
        inserted.push(
          ...(retry.data ?? []).map((row) => ({
            id: String(row.id),
            attendance_day: null,
            sort_order: Number(row.sort_order),
          })),
        )
      } else if (insertedResult.error) throw new Error(insertedResult.error.message)
      else {
        inserted.push(
          ...(insertedResult.data ?? []).map((row) => ({
            id: String(row.id),
            attendance_day: row.attendance_day ? String(row.attendance_day) : null,
            sort_order: Number(row.sort_order),
          })),
        )
      }
    }

    if (plan.deleteIds.length) {
      const { error } = await admin.from(table).delete().eq(parent, parentId).in("id", plan.deleteIds)
      if (error) throw new Error(error.message)
    }

      if (leadDesired) {
        const leadId =
          plan.updates.find((item) => item.row.isLeadGuest)?.id ??
          inserted.find(
            (row) =>
              row.sort_order === leadDesired.sortOrder &&
              (row.attendance_day ?? null) === (leadDesired.attendanceDay ?? null),
          )?.id
        if (leadId) {
          const { error } = await admin
            .from(table)
            .update({ is_lead_guest: true, updated_at: now })
            .eq("id", leadId)
            .eq(parent, parentId)
          if (error) throw new Error(error.message)
        }
      }
    }

    const namedCount = desired.filter((row) => row.fullName).length
    const ticketQuantity = sameGuestQuantity(places) ?? places[0]?.quantity ?? booking.quantity
    const currentOps = orderId
      ? await admin
          .from("order_operations")
          .select("guest_details_status")
          .eq("order_id", orderId)
          .maybeSingle()
      : await admin
          .from("deal_operations")
          .select("guest_details_status")
          .eq("deal_id", booking.dealId)
          .maybeSingle()
    const currentStatus = String(currentOps.data?.guest_details_status ?? "requested")
    const nextStatus = guestDetailsStatusAfterForm({
      namedCount,
      ticketQuantity,
      mode,
      dayCount: Math.max(1, places.length),
      submitted: input.submit || invite.status === "submitted",
      hasNamedLead: Boolean(leadDesired),
      currentStatus,
    })

    const opsState = await writeAttendanceMode(
      admin,
      { orderId, dealId: booking.dealId },
      mode,
      nextStatus,
      booking.ownerProfileId,
    )

    const invitePatch: Record<string, unknown> = {
      attendance_mode: mode,
      status: input.submit || invite.status === "submitted" ? "submitted" : "open",
      last_saved_at: now,
      updated_at: now,
    }
    if (input.submit) invitePatch.submitted_at = now
    await admin.from("guest_details_invites").update(invitePatch).eq("id", invite.id)

    if (booking.ownerProfileId && UUID_RE.test(booking.ownerProfileId)) {
      await syncDealWorkflowFromOperations(admin, {
        actorProfileId: booking.ownerProfileId,
        dealId: booking.dealId,
        orderId,
        guestDetailsStatus: nextStatus,
        deliveryStatus: opsState.deliveryStatus,
        fulfilmentStatus: opsState.fulfilmentStatus,
      })
    }

    revalidatePath("/admin/operations")
    revalidatePath("/admin/deals", "layout")
    revalidatePath(`/admin/deals/${booking.dealId}`)
    revalidatePath("/admin/catalog", "layout")
    for (const packageId of booking.packageIds) {
      revalidatePath(`/admin/catalog/${packageId}`)
    }

    const loaded = await getPublicGuestDetailsForm(input.token)
    if (!loaded.form) return { ok: false, message: "Guest details were saved but could not be reloaded." }
    return {
      ok: true,
      message: input.submit ? "Guest details submitted. Thank you." : "Progress saved. You can finish this later.",
      form: loaded.form,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save guest details."
    return {
      ok: false,
      message: missingGuestDetailsSchema(message) ? guestDetailsMigrationMessage() : message,
    }
  }
}
