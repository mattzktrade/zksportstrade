import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { loadAssistantReadiness } from "@/lib/assistant/readiness"

export const dynamic = "force-dynamic"

export default async function AssistantReadinessPage() {
  await requireAdmin()
  const data = await loadAssistantReadiness()

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Assistant knowledge checklist"
        description="Fill this before turning auto-send on. The assistant can only quote what is in the CRM."
        action={
          <Link href="/admin/assistant" className="text-xs font-medium text-primary">
            Back to inbox
          </Link>
        }
      />
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-semibold">{data.summary.headline}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {data.summary.details.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Export a few good WhatsApp threads from your phone (Chat → Export) and paste the best replies into Knowledge as
          style examples. The CRM has no historical WhatsApp inbox.
        </p>
      </div>
      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Products missing copy, photos, FAQs or a brochure</h2>
        <div className="divide-y divide-[#f0f1f3]">
          {data.catalogIssues.slice(0, 80).map((row) => (
            <Link key={row.id} href={row.href} className="block px-4 py-3 hover:bg-slate-50">
              <p className="text-[13px] font-medium">{row.name}</p>
              <p className="text-[11px] text-muted-foreground">{row.raceName}</p>
              <p className="mt-1 text-[11px] text-primary">{row.missing.join(" · ")}</p>
            </Link>
          ))}
          {data.catalogIssues.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">Upcoming sellable products look complete.</p>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold">Contacts missing a WhatsApp number</h2>
        <div className="divide-y divide-[#f0f1f3]">
          {data.contactsMissingPhone.map((row) => (
            <Link key={row.id} href={row.href} className="block px-4 py-3 hover:bg-slate-50">
              <p className="text-[13px] font-medium">{row.fullName}</p>
              <p className="text-[11px] text-muted-foreground">{row.accountName}{row.email ? ` · ${row.email}` : ""}</p>
            </Link>
          ))}
          {data.contactsMissingPhone.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">Active contacts have usable phone numbers.</p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
