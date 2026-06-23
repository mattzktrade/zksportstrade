/** Stored on packages.duration; labels shown in admin and portal. */
export const PACKAGE_DURATION_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "3_day", label: "3 day package" },
  { value: "2_day", label: "2 day package" },
  { value: "thursday_only", label: "Thursday only" },
  { value: "friday_only", label: "Friday only" },
  { value: "saturday_only", label: "Saturday only" },
  { value: "sunday_only", label: "Sunday only" },
] as const

export type PackageDurationValue = (typeof PACKAGE_DURATION_OPTIONS)[number]["value"]

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  PACKAGE_DURATION_OPTIONS.map((o) => [o.value, o.label]),
)

export function packageDurationLabel(value: string | null | undefined): string | null {
  if (value == null || value === "") return null
  return LABEL_BY_VALUE[value] ?? value.replace(/_/g, " ")
}

/** True when the stored name already includes day / session wording from the sheet. */
export function nameIncludesDurationLabel(name: string): boolean {
  const n = name.trim()
  return (
    /^\d+\s*Days?\s/i.test(n) ||
    /^Saturday\s*(?:&|and)\s*Sunday\s/i.test(n) ||
    /^(?:Friday|Saturday|Sunday)\s+/i.test(n)
  )
}

/** Short prefix for admin catalog titles, e.g. "3 Day", "Sunday". */
export function packageDurationTitlePrefix(value: string | null | undefined): string | null {
  switch (value) {
    case "3_day":
      return "3 Day"
    case "2_day":
      return "2 Day"
    case "thursday_only":
      return "Thursday"
    case "friday_only":
      return "Friday"
    case "saturday_only":
      return "Saturday"
    case "sunday_only":
      return "Sunday"
    default:
      return null
  }
}

export function isValidPackageDuration(value: string): boolean {
  return value in LABEL_BY_VALUE
}

/** Infer stored duration from display name when admin leaves duration blank on create. */
export function inferPackageDurationFromName(name: string): PackageDurationValue | "" {
  const n = name.trim()
  if (!n) return ""

  if (/\b3\s*days?\b/i.test(n)) return "3_day"
  if (/\b2\s*days?\b/i.test(n) || /\bsaturday\s*(?:&|and)\s*sunday\b/i.test(n)) return "2_day"
  if (/\bsaturday\s+only\b/i.test(n) || /^saturday\b/i.test(n)) return "saturday_only"
  if (/\bsunday\s+only\b/i.test(n) || /^sunday\b/i.test(n)) return "sunday_only"
  if (/\bfriday\s+only\b/i.test(n) || /^friday\b/i.test(n)) return "friday_only"
  if (/\bthursday\s+only\b/i.test(n) || /^thursday\b/i.test(n)) return "thursday_only"

  return ""
}
