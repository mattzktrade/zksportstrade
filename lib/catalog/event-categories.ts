export const EVENT_CATEGORIES = [
  "formula_1",
  "football",
  "tennis",
  "cricket",
  "rugby",
  "concert",
  "nfl",
  "basketball",
  "baseball",
  "horse_racing",
  "motorsports",
  "boxing",
  "golf",
  "other",
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  formula_1: "Formula 1",
  football: "Football",
  tennis: "Tennis",
  cricket: "Cricket",
  rugby: "Rugby",
  concert: "Concerts",
  nfl: "NFL",
  basketball: "Basketball",
  baseball: "Baseball",
  horse_racing: "Horse racing",
  motorsports: "Motorsports",
  boxing: "Boxing",
  golf: "Golf",
  other: "Other",
}

export function isEventCategory(value: string): value is EventCategory {
  return EVENT_CATEGORIES.includes(value as EventCategory)
}

/** Sales may create these from an enquiry. Formula 1 races stay catalog-only. */
export const ENQUIRY_EVENT_CATEGORIES = EVENT_CATEGORIES.filter(
  (category): category is Exclude<EventCategory, "formula_1"> => category !== "formula_1",
)

export function isEnquiryEventCategory(value: string): value is Exclude<EventCategory, "formula_1"> {
  return ENQUIRY_EVENT_CATEGORIES.includes(value as Exclude<EventCategory, "formula_1">)
}
