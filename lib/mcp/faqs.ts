import type { SupabaseClient } from "@supabase/supabase-js"
import { articleMatchesQuery } from "@/lib/assistant/knowledge"
import { answeredPackageFaqs, parsePackageFaqs } from "@/lib/catalog/package-faqs"
import { McpToolError } from "@/lib/mcp/types"

type FaqHit = {
  id: string
  question: string
  answer: string
  source: "knowledge" | "package" | "example"
  package_id?: string
  package_name?: string
}

export async function mcpSearchFaqs(admin: SupabaseClient, query: string): Promise<unknown> {
  const needle = query.trim()
  if (!needle) throw new McpToolError("query is required.")

  const [{ data: articles, error: articleError }, { data: examples, error: exampleError }, { data: packages, error: packageError }] =
    await Promise.all([
      admin
        .from("knowledge_articles")
        .select("id, title, body, category")
        .eq("active", true)
        .limit(80),
      admin
        .from("knowledge_examples")
        .select("id, question, answer")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("packages")
        .select("id, name, faqs")
        .eq("is_hidden", false)
        .is("shell_parent_package_id", null)
        .limit(200),
    ])

  if (articleError) throw new McpToolError(articleError.message)
  if (exampleError) throw new McpToolError(exampleError.message)
  if (packageError) throw new McpToolError(packageError.message)

  const hits: FaqHit[] = []

  for (const row of articles ?? []) {
    const title = String(row.title ?? "")
    const body = String(row.body ?? "")
    if (!articleMatchesQuery(title, body, needle)) continue
    hits.push({
      id: `knowledge:${row.id}`,
      question: title,
      answer: body,
      source: "knowledge",
    })
  }

  for (const row of examples ?? []) {
    const question = String(row.question ?? "")
    const answer = String(row.answer ?? "")
    if (!articleMatchesQuery(question, answer, needle)) continue
    hits.push({
      id: `example:${row.id}`,
      question: question || "Saved reply",
      answer,
      source: "example",
    })
  }

  for (const row of packages ?? []) {
    const faqs = answeredPackageFaqs(parsePackageFaqs(row.faqs))
    for (const faq of faqs) {
      if (!articleMatchesQuery(faq.question, faq.answer, needle)) continue
      hits.push({
        id: `package:${row.id}:${faq.id}`,
        question: faq.question,
        answer: faq.answer,
        source: "package",
        package_id: String(row.id),
        package_name: String(row.name ?? ""),
      })
    }
  }

  return { faqs: hits.slice(0, 20) }
}
