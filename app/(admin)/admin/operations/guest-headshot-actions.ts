"use server"

import { randomUUID } from "crypto"
import { hasCmsPermission } from "@/lib/auth/permissions"
import {
  GUEST_HEADSHOT_BUCKET,
  inspectGuestHeadshot,
  isSafeHeadshotObjectPath,
  MAX_GUEST_HEADSHOT_BYTES,
  normalisedHeadshotPath,
  staffHeadshotObjectPath,
  uploadGuestHeadshot,
} from "@/lib/guest-details/storage"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { guestHeadshotDataUrl } from "@/lib/tickets/public"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type UploadResult =
  | { ok: true; path: string; previewUrl: string }
  | { ok: false; message: string }

type PreviewResult = { ok: true; url: string } | { ok: false; message: string }

async function gate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  const admin = createAdminClient()
  if (!admin) return null
  return { profile, admin }
}

export async function uploadOperationsGuestHeadshot(formData: FormData): Promise<UploadResult> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const dealId = String(formData.get("dealId") ?? "").trim()
  const orderId = String(formData.get("orderId") ?? "").trim()
  const scopeId = UUID_RE.test(dealId) ? dealId : UUID_RE.test(orderId) ? orderId : ""
  if (!scopeId) return { ok: false, message: "Choose a booking before adding a headshot." }

  const file = formData.get("file")
  if (!(file instanceof File)) return { ok: false, message: "Choose a JPG or PNG headshot." }
  if (file.size > MAX_GUEST_HEADSHOT_BYTES) {
    return { ok: false, message: "Headshot must be a JPG or PNG under 5 MB." }
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const inspected = inspectGuestHeadshot(bytes)
    const path = staffHeadshotObjectPath(scopeId, randomUUID(), inspected.ext)
    await uploadGuestHeadshot(path, bytes, inspected.kind)
    const preview = await guestHeadshotPreviewUrl(path)
    return {
      ok: true,
      path,
      previewUrl: preview.ok ? preview.url : "",
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not upload that photo." }
  }
}

export async function guestHeadshotPreviewUrl(path: string): Promise<PreviewResult> {
  const session = await gate()
  if (!session) return { ok: false, message: "Operations permission is required." }
  const normalised = normalisedHeadshotPath(path)
  if (!isSafeHeadshotObjectPath(normalised)) return { ok: false, message: "Headshot not found." }
  const { data } = await session.admin.storage.from(GUEST_HEADSHOT_BUCKET).createSignedUrl(normalised, 60 * 30)
  if (data?.signedUrl) return { ok: true, url: data.signedUrl }
  const fallback = await guestHeadshotDataUrl(normalised)
  if (fallback) return { ok: true, url: fallback }
  return { ok: false, message: "Headshot not found." }
}
