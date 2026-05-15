import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminAgentsWithOrderStats } from "@/lib/admin/queries"
import { AgentsAdminClient } from "./agents-admin-client"

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireAdmin()
  const { q } = await searchParams
  const needle = q?.trim().toLowerCase() ?? ""
  const rows = await getAdminAgentsWithOrderStats()

  const filtered = needle
    ? rows.filter((a) => {
        const blob = `${a.email} ${a.full_name} ${a.company_name} ${a.mobile ?? ""} ${a.orderSearchBlob}`.toLowerCase()
        return blob.includes(needle)
      })
    : rows

  return (
    <div className="p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approved trade partners with live order counts, open invoice counts, and net sales from Supabase. Expand a row
          to set each invoice workflow status (agents see the same values on Invoices).
        </p>
      </div>

      <form method="get" className="flex flex-wrap gap-2 items-center">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name, company, email, order ref, or package"
          className="flex-1 min-w-[200px] max-w-md px-4 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
        >
          Search
        </button>
        {needle && (
          <Link href="/admin/agents" className="text-sm text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approved agents yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents match that search.</p>
      ) : (
        <AgentsAdminClient rows={filtered} />
      )}
    </div>
  )
}
