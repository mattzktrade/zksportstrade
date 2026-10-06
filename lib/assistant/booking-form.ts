import { classifyClientMessage } from "@/lib/assistant/classify"

export type BookingFormPrepareCheck = {
  ready: boolean
  missing: string[]
  portalInstead: boolean
}

export function detectAgreement(text: string): boolean {
  return classifyClientMessage(text).wantsBooking
}

export function bookingFormPrepareCheck(input: {
  dealId: string | null
  hasPackage: boolean
  hasQuantity: boolean
  hasPricedLines: boolean
  portalCapable: boolean
  contactEmail: boolean
}): BookingFormPrepareCheck {
  const missing: string[] = []
  if (!input.dealId) missing.push("enquiry")
  if (!input.hasPackage) missing.push("package")
  if (!input.hasQuantity) missing.push("quantity")
  if (!input.hasPricedLines) missing.push("price on the deal")
  if (!input.contactEmail) missing.push("client email")
  return {
    ready: missing.length === 0,
    missing,
    portalInstead: input.portalCapable && missing.length > 0,
  }
}
