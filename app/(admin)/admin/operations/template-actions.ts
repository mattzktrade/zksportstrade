"use server"

import { revalidatePath } from "next/cache"
import { hasCmsPermission } from "@/lib/auth/permissions"
import {
  DEFAULT_OPERATIONS_EMAIL_TEMPLATES,
  isOperationsEmailKind,
  type OperationsEmailKind,
  type OperationsEmailTemplate,
} from "@/lib/operations/emails"
import { getPortalProfile } from "@/lib/supabase/profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type Result<T extends object = object> =
  | ({ ok: true; message: string } & T)
  | { ok: false; message: string }

async function operationsGate() {
  const profile = await getPortalProfile()
  if (!profile || !hasCmsPermission(profile, "operations.manage")) return null
  return { profile, supabase: await createClient(), admin: createAdminClient() }
}

export async function loadOperationsEmailTemplates(): Promise<OperationsEmailTemplate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("operations_email_templates")
    .select("kind, subject, body, updated_at")
    .order("kind")
  const fromDb = new Map<string, OperationsEmailTemplate>()
  if (!error) {
    for (const row of data ?? []) {
      if (!isOperationsEmailKind(String(row.kind))) continue
      fromDb.set(String(row.kind), {
        kind: row.kind,
        subject: String(row.subject),
        body: String(row.body),
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      })
    }
  }
  return (Object.keys(DEFAULT_OPERATIONS_EMAIL_TEMPLATES) as OperationsEmailKind[]).map((kind) => {
    return fromDb.get(kind) ?? { kind, ...DEFAULT_OPERATIONS_EMAIL_TEMPLATES[kind], updatedAt: null }
  })
}

export async function saveOperationsEmailTemplate(input: {
  kind: string
  subject: string
  body: string
}): Promise<Result> {
  const gate = await operationsGate()
  if (!gate || !gate.admin) return { ok: false, message: "Operations permission is required." }
  if (!isOperationsEmailKind(input.kind)) return { ok: false, message: "Unknown email type." }
  const subject = input.subject.trim()
  const body = input.body.trim()
  if (!subject) return { ok: false, message: "Subject is required." }
  if (!body) return { ok: false, message: "Email body is required." }
  const { error } = await gate.admin.from("operations_email_templates").upsert(
    {
      kind: input.kind,
      subject,
      body,
      updated_by: gate.profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "kind" },
  )
  if (error) {
    return {
      ok: false,
      message: /operations_email_templates/i.test(error.message)
        ? "Apply the latest operations SQL in Supabase first, then save templates."
        : error.message,
    }
  }
  revalidatePath("/admin/operations")
  return { ok: true, message: "Template saved." }
}
