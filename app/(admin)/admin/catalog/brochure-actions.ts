"use server"

import { requireAdminAction } from "@/app/(admin)/actions"
import { createPackageBrochureForId } from "@/lib/brochures/create"
import {
  createPackageGuestGuideForId,
  savePackageGuestGuideContentForId,
} from "@/lib/brochures/guest-guide/create"
import type { GuestGuideContent, GuestGuideCreateResult } from "@/lib/brochures/guest-guide/types"
import type { BrochureCreateResult } from "@/lib/brochures/types"

export async function createPackageBrochure(input: {
  packageId: string
  replace?: boolean
}): Promise<BrochureCreateResult> {
  const gate = await requireAdminAction("cms.access")
  if (!gate.ok) return { ok: false, message: gate.message, code: "forbidden" }
  return createPackageBrochureForId({
    supabase: gate.supabase,
    packageId: input.packageId,
    replace: input.replace === true,
  })
}

export async function savePackageGuestGuideContent(input: {
  packageId: string
  content: GuestGuideContent
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const gate = await requireAdminAction("cms.access")
  if (!gate.ok) return { ok: false, message: gate.message }
  return savePackageGuestGuideContentForId({
    supabase: gate.supabase,
    packageId: input.packageId,
    content: input.content,
  })
}

export async function createPackageGuestGuide(input: {
  packageId: string
  replace?: boolean
  content?: GuestGuideContent
}): Promise<GuestGuideCreateResult> {
  const gate = await requireAdminAction("cms.access")
  if (!gate.ok) return { ok: false, message: gate.message, code: "forbidden" }
  return createPackageGuestGuideForId({
    supabase: gate.supabase,
    packageId: input.packageId,
    replace: input.replace === true,
    content: input.content,
  })
}
