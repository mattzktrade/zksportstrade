"use server"

import { requireAdminAction } from "@/app/(admin)/actions"
import { createPackageBrochureForId } from "@/lib/brochures/create"
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
