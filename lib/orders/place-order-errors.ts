/** User-safe messages for place_order RPC failures. */
export function mapPlaceOrderError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("insufficient_stock")) return "Not enough capacity left for this package. Try fewer guests or another date."
  if (m.includes("leaves_one_remaining")) {
    return "This quantity would leave a single place unsold. When only a few places remain, book all remaining places together or choose a smaller group."
  }
  if (m.includes("agent_not_approved") || m.includes("not_approved")) {
    return "This agent account is not approved to place orders yet."
  }
  if (m.includes("agent_not_found")) return "Agent account was not found."
  if (m.includes("forbidden")) return "You do not have permission to place orders for another agent."
  if (m.includes("not_authenticated")) return "Please sign in again."
  if (m.includes("package_enquiry_only")) return "This package cannot be booked online."
  if (m.includes("package_price_missing")) return "This package has no trade price and cannot be booked online."
  if (m.includes("package_not_found")) return "Package was not found."
  if (m.includes("inventory_missing")) return "Inventory is not set up for this package."
  if (m.includes("invalid_guests")) return "Guest count is invalid."
  if (m.includes("event_has_ended")) return "This event has finished and is no longer available to book."
  if (m.includes("booking_approval_required")) {
    return "This package requires approval before booking. Please complete the Paddock Club request step at checkout."
  }
  if (m.includes("pending_request_exists")) {
    return "You already have a pending approval request for this package. We will email you when it has been reviewed."
  }
  if (m.includes("booking_approval_not_required")) {
    return "This package does not use the approval request flow. Please complete checkout normally."
  }
  return "Could not complete the booking. Please try again or contact support."
}

export function mapBookingApprovalError(message: string): string {
  const mapped = mapPlaceOrderError(message)
  if (mapped !== "Could not complete the booking. Please try again or contact support.") return mapped
  if (message.toLowerCase().includes("request_not_pending")) {
    return "This request has already been reviewed."
  }
  if (message.toLowerCase().includes("request_not_found")) return "Booking request was not found."
  return "Could not submit your request. Please try again or contact support."
}
