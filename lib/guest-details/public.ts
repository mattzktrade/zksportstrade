import {
  bookingDayPlaces,
  guestDetailsDateRangeLabel,
  seedGuestDetailsForm,
  type GuestAttendanceMode,
  type GuestDetailsDayPlace,
  type GuestFormPerson,
} from "@/lib/guest-details/model"
import { loadGuestDetailsBookingContext, loadGuestDetailsInviteByToken } from "@/lib/guest-details/invite"
import { createAdminClient } from "@/lib/supabase/admin"

export type PublicGuestDetailsForm = {
  token: string
  inviteId: string
  companyName: string
  eventLabel: string
  packageName: string
  datesLabel: string
  places: GuestDetailsDayPlace[]
  mode: GuestAttendanceMode
  sameGuests: GuestFormPerson[]
  perDayGuests: Record<string, GuestFormPerson[]>
  allowSameMode: boolean
  showModePicker: boolean
  submitted: boolean
  expiresAt: string
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

type GuestRow = {
  id: string
  full_name: string | null
  is_lead_guest: boolean | null
  headshot_path: string | null
  attendance_day: string | null
  sort_order: number | null
}

async function loadGuestRows(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  table: "order_guests" | "deal_guests",
  parent: "order_id" | "deal_id",
  parentId: string,
): Promise<GuestRow[]> {
  const full = "id, full_name, is_lead_guest, headshot_path, attendance_day, sort_order"
  const min = "id, full_name, is_lead_guest, sort_order"
  const withCols = await admin.from(table).select(full).eq(parent, parentId).order("sort_order")
  if (!withCols.error && withCols.data) return withCols.data as GuestRow[]
  const fallback = await admin.from(table).select(min).eq(parent, parentId).order("sort_order")
  return (fallback.data ?? []) as GuestRow[]
}

async function loadGuests(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orderId: string | null,
  dealId: string | null,
): Promise<GuestRow[]> {
  if (orderId) {
    const rows = await loadGuestRows(admin, "order_guests", "order_id", orderId)
    if (rows.length) return rows
  }
  if (dealId) return loadGuestRows(admin, "deal_guests", "deal_id", dealId)
  return []
}

export async function getPublicGuestDetailsForm(token: string): Promise<{
  form: PublicGuestDetailsForm | null
  unavailableReason: "invalid" | "expired" | null
}> {
  const admin = createAdminClient()
  if (!admin) return { form: null, unavailableReason: "invalid" }
  const invite = await loadGuestDetailsInviteByToken(admin, token)
  if (!invite) return { form: null, unavailableReason: "invalid" }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    return { form: null, unavailableReason: "expired" }
  }
  if (!invite.dealId) return { form: null, unavailableReason: "invalid" }

  const booking = await loadGuestDetailsBookingContext(admin, invite.dealId)
  if (!booking) return { form: null, unavailableReason: "invalid" }

  const places = bookingDayPlaces(booking.lines, booking.eventDate)
  const orderId = invite.orderId || booking.orderId
  const guests = await loadGuests(admin, orderId, invite.dealId)
  const { data: orderOps } = orderId
    ? await admin.from("order_operations").select("guest_attendance_mode").eq("order_id", orderId).maybeSingle()
    : { data: null }
  const { data: dealOps } = await admin
    .from("deal_operations")
    .select("guest_attendance_mode")
    .eq("deal_id", invite.dealId)
    .maybeSingle()
  const storedMode =
    (orderOps as { guest_attendance_mode?: string } | null)?.guest_attendance_mode ??
    (dealOps as { guest_attendance_mode?: string } | null)?.guest_attendance_mode ??
    invite.attendanceMode

  const seeded = seedGuestDetailsForm({
    guests: guests.map((row) => ({
      id: String(row.id),
      fullName: blank(row.full_name),
      isLeadGuest: Boolean(row.is_lead_guest),
      headshotPath: blank(row.headshot_path),
      attendanceDay: blank(row.attendance_day),
      sortOrder: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
    })),
    places,
    storedMode,
  })

  return {
    form: {
      token,
      inviteId: invite.id,
      companyName: booking.accountName,
      eventLabel: booking.eventLabel || "—",
      packageName: booking.packageName || "—",
      datesLabel: guestDetailsDateRangeLabel(places),
      places,
      ...seeded,
      submitted: invite.status === "submitted",
      expiresAt: invite.expiresAt,
    },
    unavailableReason: null,
  }
}
