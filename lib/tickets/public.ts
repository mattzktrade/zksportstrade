import { downloadGuestHeadshot } from "@/lib/guest-details/storage"
import { createAdminClient } from "@/lib/supabase/admin"
import { validDayLabels } from "@/lib/tickets/model"
import { ticketQrPngDataUrl } from "@/lib/tickets/qr"
import { loadTicketByPublicToken, ticketQrPayload } from "@/lib/tickets/store"
import { isTicketPublicToken } from "@/lib/tickets/url"
import { walletPassStatus, type WalletPassStatus } from "@/lib/tickets/wallet"
import type { CostDaySlot } from "@/lib/inventory/day-cost-allocation"

export type PublicTicketView = {
  token: string
  ticketId: string
  voided: boolean
  guestName: string
  eventLabel: string
  packageName: string
  venue: string
  days: CostDaySlot[]
  daysLabel: string
  shortCode: string
  qrDataUrl: string
  qrPayload: string
  supplierUrl: string | null
  hasHeadshot: boolean
  wallet: { apple: WalletPassStatus; google: WalletPassStatus }
}

export async function getPublicTicketView(token: string): Promise<PublicTicketView | null> {
  if (!isTicketPublicToken(token)) return null
  const admin = createAdminClient()
  if (!admin) return null
  const ticket = await loadTicketByPublicToken(admin, token)
  if (!ticket || ticket.kind === "physical") return null

  let guestName = ticket.holderName?.trim() || (ticket.walkUp ? "Walk-up guest" : "Guest")
  let packageName = "Hospitality"
  let eventLabel = ticket.eventDate ?? "Event"
  let headshotPath: string | null = null
  if (ticket.guest) {
    const table = ticket.guest.source === "order" ? "order_guests" : "deal_guests"
    const { data } = await admin.from(table).select("full_name, headshot_path").eq("id", ticket.guest.id).maybeSingle()
    guestName = String(data?.full_name ?? "").trim() || guestName
    headshotPath = String((data as { headshot_path?: string | null } | null)?.headshot_path ?? "").trim() || null
  }
  if (ticket.packageId) {
    const { data } = await admin
      .from("packages")
      .select("name, races(name, season)")
      .eq("id", ticket.packageId)
      .maybeSingle()
    packageName = String(data?.name ?? packageName)
    const raceRaw = data?.races as { name?: string; season?: number } | { name?: string; season?: number }[] | null
    const race = Array.isArray(raceRaw) ? raceRaw[0] : raceRaw
    if (race?.name) eventLabel = [race.name, race.season].filter(Boolean).join(" ")
  }

  const payload = ticketQrPayload(ticket.id)
  return {
    token,
    ticketId: ticket.id,
    voided: ticket.status === "void" || Boolean(ticket.voidedAt),
    guestName,
    eventLabel,
    packageName,
    venue: ticket.venueName ?? "",
    days: ticket.validDays,
    daysLabel: validDayLabels(ticket.validDays),
    shortCode: ticket.shortCode,
    qrDataUrl: ticket.status === "void" ? "" : await ticketQrPngDataUrl(payload),
    qrPayload: payload,
    supplierUrl: ticket.supplierUrl,
    hasHeadshot: Boolean(headshotPath),
    wallet: walletPassStatus(),
  }
}

export async function getPublicTicketHeadshotBytes(token: string): Promise<Uint8Array | null> {
  if (!isTicketPublicToken(token)) return null
  const admin = createAdminClient()
  if (!admin) return null
  const ticket = await loadTicketByPublicToken(admin, token)
  if (!ticket || ticket.kind === "physical" || !ticket.guest) return null
  const table = ticket.guest.source === "order" ? "order_guests" : "deal_guests"
  const { data } = await admin.from(table).select("headshot_path").eq("id", ticket.guest.id).maybeSingle()
  const path = String((data as { headshot_path?: string | null } | null)?.headshot_path ?? "").trim()
  if (!path) return null
  try {
    return await downloadGuestHeadshot(path)
  } catch {
    return null
  }
}

export async function guestHeadshotDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  try {
    const bytes = await downloadGuestHeadshot(path)
    const isPng = bytes[0] === 0x89
    const mime = isPng ? "image/png" : "image/jpeg"
    const b64 = Buffer.from(bytes).toString("base64")
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}
