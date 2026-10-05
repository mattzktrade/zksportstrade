import { enquiryCrmStageFromDeal, isEnquiryPipelineStage } from "@/lib/crm/deal-pipeline"

export type EnquiryExpiryEvent = {
  eventDate: string | null | undefined
}

/**
 * An enquiry auto-moves to Expired only when it is still an enquiry and every
 * event on it has already taken place. One future event keeps the current stage.
 * Enquiries with no event, or an event with no date, stay where they are.
 * The event has taken place from the calendar day after its date, Europe/London,
 * the same cutoff used to stop new bookings.
 */
export function enquiryShouldAutoExpire(input: {
  stage: string
  enquiryStage?: string | null
  events: EnquiryExpiryEvent[]
  today: string
}): boolean {
  if (!isEnquiryPipelineStage(input.stage)) return false
  const stage = enquiryCrmStageFromDeal({
    stage: input.stage,
    enquiry_stage: input.enquiryStage,
  })
  if (stage === "expired" || stage === "not_interested") return false
  if (input.events.length === 0) return false
  const today = input.today.slice(0, 10)
  const dates = input.events.map((event) => (event.eventDate ?? "").slice(0, 10))
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) return false
  return dates.every((date) => date < today)
}
