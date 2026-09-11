import { createAdminClient } from "@/lib/supabase/admin"

export const GUEST_HEADSHOT_BUCKET = "guest-headshots"
export const MAX_GUEST_HEADSHOT_BYTES = 5 * 1024 * 1024

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export type GuestHeadshotKind = "image/jpeg" | "image/png"

export function inspectGuestHeadshot(bytes: Uint8Array): { kind: GuestHeadshotKind; ext: "jpg" | "png" } {
  if (bytes.length < 24 || bytes.length > MAX_GUEST_HEADSHOT_BYTES) {
    throw new Error("Headshot must be a JPG or PNG under 5 MB.")
  }
  if (JPEG_MAGIC.every((value, index) => bytes[index] === value)) {
    return { kind: "image/jpeg", ext: "jpg" }
  }
  if (PNG_MAGIC.every((value, index) => bytes[index] === value)) {
    return { kind: "image/png", ext: "png" }
  }
  throw new Error("Headshot must be a JPG or PNG image.")
}

export function guestHeadshotObjectPath(inviteId: string, fileId: string, ext: "jpg" | "png"): string {
  return `${inviteId}/${fileId}.${ext}`
}

export function headshotBelongsToInvite(path: string, inviteId: string): boolean {
  const normalised = normalisedHeadshotPath(path)
  return (
    Boolean(inviteId) &&
    normalised.startsWith(`${inviteId}/`) &&
    !normalised.includes("..") &&
    !normalised.includes("\\")
  )
}

export function normalisedHeadshotPath(path: string): string {
  return path.replace(/^guest-headshots\//, "").replace(/^\/+/, "")
}

export async function uploadGuestHeadshot(path: string, bytes: Uint8Array, contentType: GuestHeadshotKind): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Guest photo storage is not configured.")
  const { error } = await admin.storage.from(GUEST_HEADSHOT_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  })
  if (error) throw new Error(error.message)
}

export async function downloadGuestHeadshot(path: string): Promise<Uint8Array> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Guest photo storage is not configured.")
  const { data, error } = await admin.storage.from(GUEST_HEADSHOT_BUCKET).download(normalisedHeadshotPath(path))
  if (error || !data) throw new Error(error?.message ?? "Headshot not found.")
  return new Uint8Array(await data.arrayBuffer())
}
