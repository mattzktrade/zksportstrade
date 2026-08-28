export function publicBookingFormSignError(message: string): { error: string; status: number } {
  const m = message.toLowerCase()
  if (m.includes("expired")) {
    return { error: "This signing link has expired.", status: 410 }
  }
  if (m.includes("not_signable")) {
    return { error: "This booking form can no longer be signed.", status: 409 }
  }
  return { error: "Could not record signature.", status: 400 }
}
