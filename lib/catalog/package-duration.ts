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

export function isValidPackageDuration(value: string): boolean {
  return value in LABEL_BY_VALUE
}
