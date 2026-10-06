import type { SupabaseClient } from "@supabase/supabase-js"
import { parsePackageFaqs } from "@/lib/catalog/package-faqs"

export function styleExampleFromEdit(original: string, sent: string): string | null {
  const before = original.trim()
  const after = sent.trim()
  if (!after) return null
  if (before === after) return null
  if (after.length < 12) return null
  return after
}

export function shouldPromoteQa(input: { question: string; answer: string }): boolean {
  return input.question.trim().length >= 8 && input.answer.trim().length >= 12
}

export async function saveStyleExample(
  admin: SupabaseClient,
  input: {
    accountId: string | null
    contactId: string | null
    question: string
    answer: string
    source?: "staff_edit" | "approved_qa" | "imported_thread" | "account_note"
  },
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const answer = input.answer.trim()
  if (answer.length < 12) return { ok: false, message: "That reply is too short to save as an example." }
  const { data, error } = await admin
    .from("knowledge_examples")
    .insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      question: input.question.trim().slice(0, 300),
      answer: answer.slice(0, 4000),
      source: input.source ?? "staff_edit",
      active: true,
    })
    .select("id")
    .single()
  if (error || !data) return { ok: false, message: error?.message || "Could not save the example." }
  return { ok: true, id: String(data.id) }
}

export async function promoteApprovedQa(
  admin: SupabaseClient,
  input: {
    question: string
    answer: string
    packageId?: string | null
  },
): Promise<{ ok: true; target: "package_faq" | "knowledge_article" } | { ok: false; message: string }> {
  if (!shouldPromoteQa(input)) {
    return { ok: false, message: "Add a short question and a real answer before saving it to the knowledge base." }
  }
  if (input.packageId) {
    const { data, error } = await admin.from("packages").select("id, faqs").eq("id", input.packageId).maybeSingle()
    if (error || !data) return { ok: false, message: error?.message || "Package not found." }
    const faqs = parsePackageFaqs(data.faqs)
    faqs.push({
      id: `assistant-${Date.now().toString(36)}`,
      question: input.question.trim().slice(0, 300),
      answer: input.answer.trim().slice(0, 2000),
    })
    const { error: updateError } = await admin.from("packages").update({ faqs }).eq("id", input.packageId)
    if (updateError) return { ok: false, message: updateError.message }
    return { ok: true, target: "package_faq" }
  }
  const slug = `qa-${input.question.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${Date.now().toString(36)}`
  const { error } = await admin.from("knowledge_articles").insert({
    slug,
    title: input.question.trim().slice(0, 180),
    body: input.answer.trim().slice(0, 8000),
    category: "faq",
    active: true,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, target: "knowledge_article" }
}
