/** User-friendly copy for Supabase signInWithPassword failures. */
export function mapSignInError(message: string): string {
  const m = message.toLowerCase()

  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) {
    return "Email or password is incorrect."
  }

  if (m.includes("email not confirmed") || m.includes("email address not confirmed")) {
    return message
  }

  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Too many sign-in attempts. Wait a few minutes and try again."
  }

  return message
}
