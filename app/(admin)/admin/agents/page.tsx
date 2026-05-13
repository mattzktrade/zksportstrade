import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getApprovedAgents } from "@/lib/admin/queries"

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireAdmin()
  const { q } = await searchParams
  const needle = q?.trim().toLowerCase() ?? ""
  const agents = await getApprovedAgents()
  const filtered = needle
    ? agents.filter((a) => {
        const blob = `${a.email} ${a.full_name} ${a.company_name}`.toLowerCase()
        return blob.includes(needle)
      })
    : agents

  return (
    <div className="p-6 lg:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approved trade partners. Payment health and booking volume will appear here once billing data is connected.
        </p>
      </div>

      <form method="get" className="flex flex-wrap gap-2 items-center">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name, company, or email"
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

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3 font-medium">Company</th>
              <th className="p-3 font-medium">Contact</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="p-3 font-medium text-foreground">{a.company_name || "—"}</td>
                <td className="p-3 text-muted-foreground">{a.full_name || "—"}</td>
                <td className="p-3 text-muted-foreground">{a.email}</td>
                <td className="p-3 text-muted-foreground whitespace-nowrap">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No agents match that search.</p>
      )}
    </div>
  )
}
