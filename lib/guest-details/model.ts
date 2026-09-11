import { isCostDaySlot, type CostDaySlot } from "@/lib/inventory/day-cost-allocation"
import { costDaySlotsForDuration } from "@/lib/inventory/day-cost-allocation"
import {
  dateIsoForDaySlot,
  formatGuestListDayChipLabel,
} from "@/lib/admin/package-guest-list-model"
import { shellDayLabel, type ShellDayDuration } from "@/lib/catalog/shell-single-tickets"
import { guestDetailsStatusFromNamedCount } from "@/lib/operations/guest-status"

export const GUEST_ATTENDANCE_MODES = ["same", "per_day"] as const
export type GuestAttendanceMode = (typeof GUEST_ATTENDANCE_MODES)[number]

export type GuestFormPerson = {
  id: string
  fullName: string
  isLeadGuest: boolean
  headshotPath: string | null
}

export type GuestDetailsDayPlace = {
  day: CostDaySlot
  quantity: number
  label: string
  shortLabel: string
}

const DAY_ORDER: CostDaySlot[] = [
  "thursday_only",
  "friday_only",
  "saturday_only",
  "sunday_only",
]

const SHORT_DAY: Record<CostDaySlot, string> = {
  thursday_only: "Thursday",
  friday_only: "Friday",
  saturday_only: "Saturday",
  sunday_only: "Sunday",
}

export function parseGuestAttendanceMode(value: string | null | undefined): GuestAttendanceMode {
  return value === "per_day" ? "per_day" : "same"
}

export function parseAttendanceDay(value: string | null | undefined): CostDaySlot | null {
  return isCostDaySlot(value) ? value : null
}

export function guestDetailsFormPath(token: string): string {
  return `/guest-details/${encodeURIComponent(token)}`
}

export function guestDetailsFormUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${guestDetailsFormPath(token)}`
}

export function guestDetailsInviteExpiry(eventDateIso: string | null | undefined, now = new Date()): Date {
  const plus120 = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000)
  const iso = eventDateIso?.trim().slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return plus120
  const eventPlus = new Date(`${iso}T00:00:00Z`)
  eventPlus.setUTCDate(eventPlus.getUTCDate() + 14)
  return eventPlus.getTime() > plus120.getTime() ? eventPlus : plus120
}

export function bookingDayPlaces(
  lines: readonly { duration: string | null | undefined; quantity: number }[],
  eventDateIso: string | null | undefined,
): GuestDetailsDayPlace[] {
  const qty = new Map<CostDaySlot, number>()
  for (const line of lines) {
    const slots = costDaySlotsForDuration(line.duration, eventDateIso)
    const amount = Math.max(0, Math.floor(Number(line.quantity) || 0))
    if (!amount) continue
    if (slots.length === 0) continue
    for (const slot of slots) {
      qty.set(slot, (qty.get(slot) ?? 0) + amount)
    }
  }
  return DAY_ORDER.filter((day) => (qty.get(day) ?? 0) > 0).map((day) => {
    const iso = dateIsoForDaySlot(eventDateIso, day)
    return {
      day,
      quantity: qty.get(day) ?? 0,
      label: iso ? formatGuestListDayChipLabel(iso) : shellDayLabel(day as ShellDayDuration),
      shortLabel: SHORT_DAY[day],
    }
  })
}

export function sameGuestQuantity(places: readonly GuestDetailsDayPlace[]): number | null {
  if (places.length === 0) return null
  const first = places[0]?.quantity ?? 0
  if (first <= 0) return null
  return places.every((place) => place.quantity === first) ? first : null
}

export function guestDetailsDateRangeLabel(places: readonly GuestDetailsDayPlace[]): string {
  if (places.length === 0) return "—"
  const first = places[0]
  const last = places[places.length - 1]
  if (!first || !last || first.day === last.day) return first?.label ?? "—"
  const start = first.label.replace(/^(\w+)\s/, (_, weekday: string) => `${weekday.slice(0, 3)} `)
  const end = last.label.replace(/^(\w+)\s/, (_, weekday: string) => `${weekday.slice(0, 3)} `)
  return `${start} – ${end}`
}

export function emptyGuestFormPeople(quantity: number): GuestFormPerson[] {
  const count = Math.max(1, Math.floor(Number(quantity) || 1))
  return Array.from({ length: count }, (_, index) => ({
    id: "",
    fullName: "",
    isLeadGuest: index === 0,
    headshotPath: null,
  }))
}

function namedPeople(people: readonly GuestFormPerson[]): GuestFormPerson[] {
  return people.filter((person) => person.fullName.trim())
}

export function flattenGuestFormPeople(input: {
  mode: GuestAttendanceMode
  sameGuests: readonly GuestFormPerson[]
  perDayGuests: Readonly<Record<string, readonly GuestFormPerson[]>>
  days: readonly CostDaySlot[]
}): GuestFormPerson[] {
  if (input.mode !== "per_day") return [...input.sameGuests]
  return input.days.flatMap((day) => [...(input.perDayGuests[day] ?? [])])
}

export function guestDetailsFormCanSubmit(input: {
  mode: GuestAttendanceMode
  sameGuests: readonly GuestFormPerson[]
  perDayGuests: Readonly<Record<string, readonly GuestFormPerson[]>>
  days: readonly CostDaySlot[]
}): { ok: true } | { ok: false; message: string } {
  const people = namedPeople(flattenGuestFormPeople(input))
  if (!people.length) {
    return { ok: false, message: "Enter at least one guest name, or mark a lead guest." }
  }
  const leads = people.filter((person) => person.isLeadGuest)
  if (leads.length !== 1) {
    return { ok: false, message: "Tick one person as the lead guest so we can complete the form." }
  }
  for (const person of people) {
    if (!person.headshotPath) {
      return {
        ok: false,
        message: `Upload a clear headshot for ${person.fullName.trim()}.`,
      }
    }
  }
  return { ok: true }
}

export function guestDetailsStatusAfterForm(input: {
  namedCount: number
  ticketQuantity: number
  mode: GuestAttendanceMode
  dayCount: number
  submitted: boolean
  hasNamedLead: boolean
  currentStatus: string
}): string {
  if (input.currentStatus === "not_required") return input.currentStatus
  if (input.submitted && input.hasNamedLead) return "complete"
  const needed =
    input.mode === "per_day"
      ? Math.max(1, Math.floor(Number(input.ticketQuantity) || 1)) *
        Math.max(1, Math.floor(Number(input.dayCount) || 1))
      : Math.max(1, Math.floor(Number(input.ticketQuantity) || 1))
  return guestDetailsStatusFromNamedCount(input.namedCount, needed, input.currentStatus)
}

export function resolveGuestAttendanceMode(
  stored: string | null | undefined,
  guests: readonly { attendanceDay?: string | null }[],
): GuestAttendanceMode {
  if (stored === "per_day") return "per_day"
  if (stored === "same") return "same"
  return guests.some((guest) => parseAttendanceDay(guest.attendanceDay)) ? "per_day" : "same"
}

export const GUEST_DETAILS_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/

export function isGuestDetailsToken(token: string): boolean {
  return GUEST_DETAILS_TOKEN_RE.test(token)
}

export function guestDetailsTokenFromText(text: string): string | null {
  const match = /\/guest-details\/([A-Za-z0-9_-]{40,60})/.exec(text)
  const token = match?.[1] ?? ""
  return isGuestDetailsToken(token) ? token : null
}

export function ensureGuestDetailsLinkInBody(body: string, formUrl: string): string {
  if (guestDetailsTokenFromText(body)) return body
  const block = `\n\nYou can fill this in on our guest details form:\n${formUrl}\n`
  const idx = body.indexOf("Kind regards,")
  if (idx >= 0) return `${body.slice(0, idx).trimEnd()}${block}\n${body.slice(idx)}`
  return `${body.trimEnd()}${block}`
}

export function isGuestDetailsUrlParagraph(text: string): boolean {
  return /^https?:\/\/\S+\/guest-details\/[A-Za-z0-9_-]{40,60}\/?$/.test(text.trim())
}

export type GuestFormSeedGuest = {
  id: string
  fullName: string | null
  isLeadGuest: boolean
  headshotPath: string | null
  attendanceDay: string | null
  sortOrder: number
}

function toFormPerson(guest: GuestFormSeedGuest): GuestFormPerson {
  return {
    id: guest.id,
    fullName: guest.fullName?.trim() ?? "",
    isLeadGuest: Boolean(guest.isLeadGuest),
    headshotPath: guest.headshotPath?.trim() || null,
  }
}

function sortSeedGuests(guests: readonly GuestFormSeedGuest[]): GuestFormSeedGuest[] {
  return [...guests].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id.localeCompare(b.id)
  })
}

export function padGuestFormPeople(
  people: readonly GuestFormPerson[],
  quantity: number,
  assignLeadIfMissing: boolean,
): GuestFormPerson[] {
  const rows = people.map((person) => ({ ...person }))
  const needed = Math.max(1, Math.floor(Number(quantity) || 1))
  while (rows.length < needed) {
    rows.push({ id: "", fullName: "", isLeadGuest: false, headshotPath: null })
  }
  if (assignLeadIfMissing && rows.length && !rows.some((row) => row.isLeadGuest)) {
    rows[0] = { ...rows[0]!, isLeadGuest: true }
  }
  return rows
}

export function seedGuestDetailsForm(input: {
  guests: readonly GuestFormSeedGuest[]
  places: readonly GuestDetailsDayPlace[]
  storedMode: string | null | undefined
}): {
  mode: GuestAttendanceMode
  sameGuests: GuestFormPerson[]
  perDayGuests: Record<string, GuestFormPerson[]>
  allowSameMode: boolean
  showModePicker: boolean
} {
  const allowSameMode = sameGuestQuantity(input.places) != null
  const showModePicker = input.places.length > 1
  let mode = resolveGuestAttendanceMode(input.storedMode, input.guests)
  if (!showModePicker) mode = "same"
  else if (!allowSameMode) mode = "per_day"

  const sameQty = sameGuestQuantity(input.places) ?? input.places[0]?.quantity ?? 1
  const allDay = sortSeedGuests(input.guests.filter((guest) => !parseAttendanceDay(guest.attendanceDay)))
  const sameGuests = padGuestFormPeople(allDay.map(toFormPerson), sameQty, true)

  const perDayGuests: Record<string, GuestFormPerson[]> = {}
  input.places.forEach((place, index) => {
    const dayGuests = sortSeedGuests(
      input.guests.filter((guest) => guest.attendanceDay === place.day),
    )
    perDayGuests[place.day] = padGuestFormPeople(dayGuests.map(toFormPerson), place.quantity, false)
    if (index === 0 && perDayGuests[place.day]?.length && !perDayGuests[place.day]!.some((row) => row.isLeadGuest)) {
      perDayGuests[place.day] = perDayGuests[place.day]!.map((row, rowIndex) => ({
        ...row,
        isLeadGuest: rowIndex === 0,
      }))
    }
  })

  return { mode, sameGuests, perDayGuests, allowSameMode, showModePicker }
}

export type DesiredGuestRow = {
  id: string | null
  fullName: string | null
  isLeadGuest: boolean
  headshotPath: string | null
  attendanceDay: CostDaySlot | null
  sortOrder: number
}

export type ExistingGuestPlanRow = {
  id: string
  attendanceDay?: string | null
  sortOrder: number
  fullName?: string | null
  tableNumber?: string | null
  ticketNumber?: string | null
  paddockTour?: string | null
}

export type GuestFormUpsertPlan = {
  updates: Array<{ id: string; row: DesiredGuestRow }>
  inserts: DesiredGuestRow[]
  deleteIds: string[]
}

function personToDesired(
  person: GuestFormPerson,
  attendanceDay: CostDaySlot | null,
  sortOrder: number,
): DesiredGuestRow | null {
  const fullName = person.fullName.trim() || null
  const id = person.id.trim() || null
  const headshotPath = person.headshotPath?.trim() || null
  if (!id && !fullName && !headshotPath) return null
  return {
    id,
    fullName,
    isLeadGuest: Boolean(person.isLeadGuest) && Boolean(fullName),
    headshotPath,
    attendanceDay,
    sortOrder,
  }
}

export function desiredGuestsFromForm(input: {
  mode: GuestAttendanceMode
  sameGuests: readonly GuestFormPerson[]
  perDayGuests: Readonly<Record<string, readonly GuestFormPerson[]>>
  days: readonly CostDaySlot[]
}): DesiredGuestRow[] {
  const rows: DesiredGuestRow[] = []
  if (input.mode !== "per_day") {
    input.sameGuests.forEach((person, index) => {
      const row = personToDesired(person, null, index)
      if (row) rows.push(row)
    })
  } else {
    for (const day of input.days) {
      ;(input.perDayGuests[day] ?? []).forEach((person, index) => {
        const row = personToDesired(person, day, index)
        if (row) rows.push(row)
      })
    }
  }
  const leadIndex = rows.findIndex((row) => row.isLeadGuest && row.fullName)
  return rows.map((row, index) => ({
    ...row,
    isLeadGuest: leadIndex >= 0 ? index === leadIndex : false,
  }))
}

function isProtectedGuest(row: ExistingGuestPlanRow): boolean {
  return Boolean(row.tableNumber?.trim() || row.ticketNumber?.trim() || row.paddockTour?.trim())
}

function attendanceKey(value: string | null | undefined): string {
  return parseAttendanceDay(value) ?? ""
}

function existingDayRank(value: string | null | undefined): number {
  const day = parseAttendanceDay(value)
  if (!day) return 99
  return DAY_ORDER.indexOf(day)
}

export function planGuestFormUpserts(
  existing: readonly ExistingGuestPlanRow[],
  desired: readonly DesiredGuestRow[],
): GuestFormUpsertPlan {
  const sortedExisting = [...existing].sort((a, b) => {
    const day = existingDayRank(a.attendanceDay) - existingDayRank(b.attendanceDay)
    if (day !== 0) return day
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id.localeCompare(b.id)
  })
  const unused = new Set(sortedExisting.map((row) => row.id))
  const byId = new Map(sortedExisting.map((row) => [row.id, row]))
  const updates: GuestFormUpsertPlan["updates"] = []
  const unmatched: DesiredGuestRow[] = []

  const sortedDesired = [...desired].sort((a, b) => {
    const day = existingDayRank(a.attendanceDay) - existingDayRank(b.attendanceDay)
    if (day !== 0) return day
    return a.sortOrder - b.sortOrder
  })

  for (const row of sortedDesired) {
    if (row.id && unused.has(row.id)) {
      updates.push({ id: row.id, row: { ...row, id: row.id } })
      unused.delete(row.id)
    } else {
      unmatched.push({ ...row, id: null })
    }
  }

  function takeExisting(pred: (row: ExistingGuestPlanRow) => boolean): ExistingGuestPlanRow | null {
    for (const row of sortedExisting) {
      if (!unused.has(row.id)) continue
      if (!pred(row)) continue
      unused.delete(row.id)
      return row
    }
    return null
  }

  const inserts: DesiredGuestRow[] = []
  for (const row of unmatched) {
    const sameSlot = takeExisting(
      (existingRow) =>
        attendanceKey(existingRow.attendanceDay) === attendanceKey(row.attendanceDay) &&
        existingRow.sortOrder === row.sortOrder,
    )
    if (sameSlot) {
      updates.push({ id: sameSlot.id, row: { ...row, id: sameSlot.id } })
      continue
    }
    const crossed = takeExisting((existingRow) => {
      if (existingRow.sortOrder !== row.sortOrder) return false
      const existingDay = parseAttendanceDay(existingRow.attendanceDay)
      return Boolean(existingDay) !== Boolean(row.attendanceDay)
    })
    if (crossed) {
      updates.push({ id: crossed.id, row: { ...row, id: crossed.id } })
      continue
    }
    inserts.push(row)
  }

  const deleteIds: string[] = []
  for (const id of unused) {
    const leftover = byId.get(id)
    if (!leftover || isProtectedGuest(leftover)) continue
    deleteIds.push(id)
  }

  return { updates, inserts, deleteIds }
}
