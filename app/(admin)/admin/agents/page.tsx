import Link from "next/link"
import dynamic from "next/dynamic"
import { requireAdmin } from "@/lib/admin/require-admin"
import { getAdminAgentsWithOrderStats } from "@/lib/admin/queries"
import { PageLoadingSpinner } from "@/components/page-loading-spinner"

const AgentsAdminClient = dynamic(
  () => import("./agents-admin-client").then((m) => ({ default: m.AgentsAdminClient })),
  { loading: () => <PageLoadingSpinner /> },
)

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
