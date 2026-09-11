import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { isGuestDetailsToken, parseGuestAttendanceMode } from "@/lib/guest-details/model"
import { savePublicGuestDetailsForm } from "@/lib/guest-details/save"
import type { GuestFormPerson } from "@/lib/guest-details/model"

export const runtime = "nodejs"

function people(value: unknown): GuestFormPerson[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
    return {
      id: String(record.id ?? ""),
      fullName: String(record.fullName ?? ""),
      isLeadGuest: record.isLeadGuest === true,
      headshotPath: record.headshotPath ? String(record.headshotPath) : null,
    }
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`guest-details:save:${ip}`, 40, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
  }
  const { token } = await context.params
  if (!isGuestDetailsToken(token)) {
    return NextResponse.json({ error: "This guest details link is invalid." }, { status: 404 })
  }
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }
  const perDayRaw = body.perDayGuests && typeof body.perDayGuests === "object" ? (body.perDayGuests as Record<string, unknown>) : {}
  const perDayGuests: Record<string, GuestFormPerson[]> = {}
  for (const [day, list] of Object.entries(perDayRaw)) {
    perDayGuests[day] = people(list)
  }
  const result = await savePublicGuestDetailsForm({
    token,
    submit: body.submit === true,
    mode: parseGuestAttendanceMode(String(body.mode ?? "same")),
    sameGuests: people(body.sameGuests),
    perDayGuests,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, message: result.message, form: result.form })
}
