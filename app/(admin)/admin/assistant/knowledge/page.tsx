import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { KnowledgeEditor } from "../knowledge-editor"

export const dynamic = "force-dynamic"

export default async function AssistantKnowledgePage() {
  await requireAdmin()
  const supabase = await createClient()
  const [{ data: articles }, { data: examples }] = await Promise.all([
    supabase.from("knowledge_articles").select("id, slug, title, category, updated_at").eq("active", true).order("title"),
    supabase
      .from("knowledge_examples")
      .select("id, question, answer, source, created_at")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(40),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Assistant knowledge"
        description="Company FAQs and approved replies. Product FAQs still live on each catalog product."
        action={
          <Link href="/admin/assistant" className="text-xs font-medium text-primary">
            Back to inbox
          </Link>
        }
      />
      <KnowledgeEditor />
      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Articles</h2>
        <div className="divide-y divide-[#f0f1f3]">
          {(articles ?? []).map((row) => (
            <div key={row.id} className="px-4 py-3">
              <p className="text-[13px] font-medium">{row.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {row.category} · {row.slug}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Approved examples</h2>
        <div className="divide-y divide-[#f0f1f3]">
          {(examples ?? []).map((row) => (
            <div key={row.id} className="px-4 py-3">
              {row.question ? <p className="text-[12px] font-medium">{row.question}</p> : null}
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#3d4148]">{row.answer}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{row.source}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
