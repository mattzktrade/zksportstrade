export function missingGuestDetailsSchema(message: string): boolean {
  const value = message.toLowerCase()
  return (
    value.includes("guest_details_invites") ||
    value.includes("guest_attendance_mode") ||
    value.includes("attendance_day") ||
    value.includes("headshot_path") ||
    value.includes("guest-headshots") ||
    value.includes("42p01") ||
    value.includes("pgrst204") ||
    value.includes("pgrst205")
  )
}

export function guestDetailsMigrationMessage(): string {
  return "Apply the guest details form SQL in Supabase first, then try again."
}
