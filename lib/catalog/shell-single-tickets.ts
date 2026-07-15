/**
 * Hidden "shell" single-ticket helpers.
 *
 * A 3-day Package in Salesforce needs three Single Ticket children (one per race day)
 * so Opportunity lines break out each day for reporting. We model those children as
 * hidden portal packages with no value and family = "Single Ticket". This module
 * derives which race days apply and produces stable ids / display names for the shells.
 *
 * Day inference: the race day (Sunday for typical grands prix, Saturday for Las Vegas
 * style events) is taken from `races.event_date`. Anything other than Sat/Sun falls
 * back to the standard Fri/Sat/Sun weekend.
 */

/** Salesforce Product2.Family value used for the auto-created day children. */
export const SHELL_SINGLE_TICKET_FAMILY = "Single Ticket" as const

export type ShellDayDuration = "thursday_only" | "friday_only" | "saturday_only" | "sunday_only"

const DAY_SHORT: Record<ShellDayDuration, string> = {
  thursday_only: "thu",
  friday_only: "fri",
  saturday_only: "sat",
  sunday_only: "sun",
}

const DAY_LABEL: Record<ShellDayDuration, string> = {
  thursday_only: "Thursday",
  friday_only: "Friday",
  saturday_only: "Saturday",
  sunday_only: "Sunday",
}

/** UTC day-of-week where 0 = Sunday, 6 = Saturday. Returns null when the date can't be parsed. */
function eventDateWeekday(eventDateIso: string | null | undefined): number | null {
  if (!eventDateIso) return null
  const iso = eventDateIso.trim()
  if (!iso) return null
  const asDate = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(iso)
  if (Number.isNaN(asDate.getTime())) return null
  return asDate.getUTCDay()
}

/**
 * Returns the three race-day durations for a 3-day package, in Thu→Sun order:
 *   Sunday race day  → Fri / Sat / Sun (default weekend)
 *   Saturday race day → Thu / Fri / Sat (Las Vegas style)
 *   Anything else    → Fri / Sat / Sun (safe default; admin can rename shells if needed)
 */
export function raceDaysForThreeDayPackage(eventDateIso: string | null | undefined): ShellDayDuration[] {
  const weekday = eventDateWeekday(eventDateIso)
  if (weekday === 6) {
    return ["thursday_only", "friday_only", "saturday_only"]
  }
  return ["friday_only", "saturday_only", "sunday_only"]
}

/**
 * The two days a 2-day package covers — the last two of the race weekend (Sat/Sun for a
 * Sunday race day, Fri/Sat for a Las Vegas–style Saturday race day).
 */
export function raceDaysForTwoDayPackage(eventDateIso: string | null | undefined): ShellDayDuration[] {
  return raceDaysForThreeDayPackage(eventDateIso).slice(-2)
}

/**
 * Which Single Ticket day durations should be linked as SF Package Item children for a
 * given package, given its own duration + race event date. Any other duration (e.g. an
 * enquiry-only tier) has no day children.
 */
export function childDayDurationsForPackage(
  duration: string | null | undefined,
  eventDateIso: string | null | undefined,
): ShellDayDuration[] {
  const d = duration?.trim() ?? ""
  if (d === "3_day") return raceDaysForThreeDayPackage(eventDateIso)
  if (d === "2_day") return raceDaysForTwoDayPackage(eventDateIso)
  if (isShellDayDuration(d)) return [d]
  return []
}

export function shellDayLabel(duration: ShellDayDuration): string {
  return DAY_LABEL[duration]
}

/** Stable, deterministic slug for a shell package so re-running creation is idempotent. */
export function shellSingleTicketPackageId(parentPackageId: string, duration: ShellDayDuration): string {
  const short = DAY_SHORT[duration]
  const base = parentPackageId.trim()
  if (!base) throw new Error("shellSingleTicketPackageId: parentPackageId is empty")
  const suffix = `-st-${short}`
  // Keep total id length safely under the packages.id 128-char limit used elsewhere.
  const maxBase = 120 - suffix.length
  const trimmed = base.length > maxBase ? base.slice(0, maxBase) : base
  return `${trimmed}${suffix}`
}

/** Salesforce/portal display name for a shell single ticket. */
export function shellSingleTicketName(parentName: string, duration: ShellDayDuration): string {
  const trimmed = parentName.trim().replace(/\s+/g, " ")
  const day = DAY_LABEL[duration]
  return `${trimmed} – ${day} Single Ticket`
}

/** Type guard for known day durations. */
export function isShellDayDuration(value: string | null | undefined): value is ShellDayDuration {
  return (
    value === "thursday_only" ||
    value === "friday_only" ||
    value === "saturday_only" ||
    value === "sunday_only"
  )
}
