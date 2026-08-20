export const EVENT_CATEGORIES = [
  "formula_1",
  "tennis",
  "football",
  "concert",
  "other",
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  formula_1: "Formula 1",
  tennis: "Tennis",
  football: "Football",
  concert: "Concert",
  other: "Other",
}

export function isEventCategory(value: string): value is EventCategory {
  return EVENT_CATEGORIES.includes(value as EventCategory)
}

