import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit"
import { isGuestDetailsToken } from "@/lib/guest-details/model"
import { loadGuestDetailsInviteByToken } from "@/lib/guest-details/invite"
import {
  downloadGuestHeadshot,
  guestHeadshotObjectPath,
  headshotBelongsToInvite,
  inspectGuestHeadshot,
  MAX_GUEST_HEADSHOT_BYTES,
  normalisedHeadshotPath,
  uploadGuestHeadshot,
} from "@/lib/guest-details/storage"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`guest-details:photo:${ip}`, 120, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
  }
  const { token } = await context.params
  const path = normalisedHeadshotPath(request.nextUrl.searchParams.get("p") ?? "")
  if (!isGuestDetailsToken(token) || !path) {
    return NextResponse.json({ error: "Headshot not found." }, { status: 404 })
  }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: "Photo service unavailable." }, { status: 503 })
  const invite = await loadGuestDetailsInviteByToken(admin, token)
  if (!invite || new Date(invite.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Headshot not found." }, { status: 404 })
  }
  if (!headshotBelongsToInvite(path, invite.id)) {
    return NextResponse.json({ error: "Headshot not found." }, { status: 404 })
  }
  try {
    const bytes = await downloadGuestHeadshot(path)
    const jpeg = bytes[0] === 0xff
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": jpeg ? "image/jpeg" : "image/png",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    })
  } catch {
    return NextResponse.json({ error: "Headshot not found." }, { status: 404 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const ip = clientIpFromHeaders(request.headers)
  if (!checkRateLimit(`guest-details:upload:${ip}`, 20, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 })
  }
  const { token } = await context.params
  if (!isGuestDetailsToken(token)) {
    return NextResponse.json({ error: "This guest details link is invalid." }, { status: 404 })
  }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: "Photo service unavailable." }, { status: 503 })
  const invite = await loadGuestDetailsInviteByToken(admin, token)
  if (!invite || new Date(invite.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This guest details form has expired." }, { status: 410 })
  }

  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a JPG or PNG headshot." }, { status: 400 })
  }
  if (file.size > MAX_GUEST_HEADSHOT_BYTES) {
    return NextResponse.json({ error: "Headshot must be a JPG or PNG under 5 MB." }, { status: 400 })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const inspected = inspectGuestHeadshot(bytes)
    const path = guestHeadshotObjectPath(invite.id, randomUUID(), inspected.ext)
    await uploadGuestHeadshot(path, bytes, inspected.kind)
    return NextResponse.json({
      ok: true,
      path,
      fileName: file.name,
      size: file.size,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload that photo."
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
