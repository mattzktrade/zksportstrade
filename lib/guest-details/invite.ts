import { getServerSiteOrigin } from "@/lib/auth/site-origin"
import { generateSigningToken, sha256 } from "@/lib/booking-forms/snapshot"
import {
  guestDetailsFormUrl,
  guestDetailsInviteExpiry,
  guestDetailsTokenFromText,
  isGuestDetailsToken,
  parseGuestAttendanceMode,
  type GuestAttendanceMode,
} from "@/lib/guest-details/model"
import { missingGuestDetailsSchema } from "@/lib/guest-details/schema"
import { createAdminClient } from "@/lib/supabase/admin"
import { eventSeasonLabel } from "@/lib/catalog/event-label"

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

export type GuestDetailsInvite = {
  id: string
  dealId: string | null
  orderId: string | null
  expiresAt: string
  attendanceMode: GuestAttendanceMode
  status: "open" | "submitted"
}

export type GuestDetailsBookingContext = {
  dealId: string
  orderId: string | null
  ownerProfileId: string | null
  accountName: string
  contactName: string
  contactEmail: string | null
  eventLabel: string
  eventDate: string | null
  packageName: string
  quantity: number
  lines: Array<{ packageId: string; duration: string | null; quantity: number }>
  packageIds: string[]
}

export async function loadGuestDetailsBookingContext(
  admin: Admin,
  dealId: string,
): Promise<GuestDetailsBookingContext | null> {
  const { data: deal, error } = await admin
    .from("deals")
    .select(
      `
      id, reference, order_id, account_id, primary_contact_id, owner_profile_id,
      crm_accounts(name, email),
      crm_contacts(full_name, email),
      deal_line_items(
        quantity, sort_order, package_id,
        packages(name, duration, event_date, races(name, season, event_date))
      )
    `,
    )
    .eq("id", dealId)
    .maybeSingle()
  if (error || !deal) return null

  const account = one(deal.crm_accounts as { name: string; email: string | null } | { name: string; email: string | null }[] | null)
  const contact = one(
    deal.crm_contacts as
      | { full_name: string; email: string | null }
      | { full_name: string; email: string | null }[]
      | null,
  )
  const lines = [...((deal.deal_line_items ?? []) as Array<{
    quantity: number
    sort_order: number
    package_id: string
    packages:
      | {
          name: string
          duration: string | null
          event_date: string | null
          races: { name: string; season: number; event_date: string | null } | { name: string; season: number; event_date: string | null }[] | null
        }
      | Array<{
          name: string
          duration: string | null
          event_date: string | null
          races: { name: string; season: number; event_date: string | null } | { name: string; season: number; event_date: string | null }[] | null
        }>
      | null
  }>)].sort((a, b) => a.sort_order - b.sort_order)

  const mapped = lines.map((line) => {
    const pkg = one(line.packages)
    const race = one(pkg?.races ?? null)
    return {
      packageId: String(line.package_id),
      duration: pkg?.duration ?? null,
      quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
      packageName: pkg?.name ?? "",
      eventLabel: race ? eventSeasonLabel(race.name, race.season) : pkg?.name ?? "",
      eventDate: race?.event_date ?? pkg?.event_date ?? null,
    }
  })
  const eventDates = mapped.map((line) => line.eventDate?.slice(0, 10)).filter((value): value is string => Boolean(value))
  const packageNames = [...new Set(mapped.map((line) => line.packageName).filter(Boolean))]
  const events = [...new Set(mapped.map((line) => line.eventLabel).filter(Boolean))]

  return {
    dealId: String(deal.id),
    orderId: deal.order_id ? String(deal.order_id) : null,
    ownerProfileId: deal.owner_profile_id ? String(deal.owner_profile_id) : null,
    accountName: account?.name ?? "your company",
    contactName: contact?.full_name ?? account?.name ?? "there",
    contactEmail: blank(contact?.email) ?? blank(account?.email),
    eventLabel: events.join(", "),
    eventDate: eventDates[0] ?? null,
    packageName: packageNames.join(", ") || "Hospitality",
    quantity: mapped.reduce((sum, line) => sum + line.quantity, 0) || 1,
    lines: mapped.map((line) => ({
      packageId: line.packageId,
      duration: line.duration,
      quantity: line.quantity,
    })),
    packageIds: [...new Set(mapped.map((line) => line.packageId))],
  }
}

function mapInvite(row: {
  id: string
  deal_id: string | null
  order_id: string | null
  expires_at: string
  attendance_mode: string
  status: string
}): GuestDetailsInvite {
  return {
    id: String(row.id),
    dealId: row.deal_id ? String(row.deal_id) : null,
    orderId: row.order_id ? String(row.order_id) : null,
    expiresAt: String(row.expires_at),
    attendanceMode: parseGuestAttendanceMode(row.attendance_mode),
    status: row.status === "submitted" ? "submitted" : "open",
  }
}

export async function loadGuestDetailsInviteByToken(
  admin: Admin,
  token: string,
): Promise<GuestDetailsInvite | null> {
  if (!isGuestDetailsToken(token)) return null
  const { data, error } = await admin
    .from("guest_details_invites")
    .select("id, deal_id, order_id, expires_at, attendance_mode, status")
    .eq("token_hash", sha256(token))
    .maybeSingle()
  if (error || !data) return null
  return mapInvite(data)
}

export async function ensureGuestDetailsInvite(input: {
  admin: Admin
  dealId: string
  orderId: string | null
  eventDateIso: string | null
  preferredToken?: string | null
  recoverFromBody?: string | null
}): Promise<{ token: string; url: string; invite: GuestDetailsInvite } | null> {
  const origin = getServerSiteOrigin()
  const expiresAt = guestDetailsInviteExpiry(input.eventDateIso).toISOString()
  const recovered = input.preferredToken || guestDetailsTokenFromText(input.recoverFromBody ?? "")
  try {
    const { data: existing, error } = await input.admin
      .from("guest_details_invites")
      .select("id, deal_id, order_id, token_hash, expires_at, attendance_mode, status")
      .eq("deal_id", input.dealId)
      .maybeSingle()
    if (error) {
      if (missingGuestDetailsSchema(error.message)) return null
      throw new Error(error.message)
    }

    if (existing && recovered && isGuestDetailsToken(recovered)) {
      await input.admin
        .from("guest_details_invites")
        .update({
          token_hash: sha256(recovered),
          expires_at: expiresAt,
          order_id: input.orderId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
      return {
        token: recovered,
        url: guestDetailsFormUrl(origin, recovered),
        invite: mapInvite({ ...existing, expires_at: expiresAt, order_id: input.orderId }),
      }
    }

    const generated = generateSigningToken()
    const now = new Date().toISOString()
    if (existing) {
      const { error: updateError } = await input.admin
        .from("guest_details_invites")
        .update({
          token_hash: generated.tokenHash,
          expires_at: expiresAt,
          order_id: input.orderId,
          updated_at: now,
        })
        .eq("id", existing.id)
      if (updateError) throw new Error(updateError.message)
      return {
        token: generated.token,
        url: guestDetailsFormUrl(origin, generated.token),
        invite: mapInvite({
          id: existing.id,
          deal_id: existing.deal_id,
          order_id: input.orderId,
          expires_at: expiresAt,
          attendance_mode: existing.attendance_mode,
          status: existing.status,
        }),
      }
    }

    const { data: created, error: insertError } = await input.admin
      .from("guest_details_invites")
      .insert({
        deal_id: input.dealId,
        order_id: input.orderId,
        token_hash: generated.tokenHash,
        expires_at: expiresAt,
        attendance_mode: "same",
        status: "open",
      })
      .select("id, deal_id, order_id, expires_at, attendance_mode, status")
      .single()
    if (insertError || !created) throw new Error(insertError?.message ?? "Could not create guest details link.")
    return {
      token: generated.token,
      url: guestDetailsFormUrl(origin, generated.token),
      invite: mapInvite(created),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (missingGuestDetailsSchema(message)) return null
    throw error
  }
}
