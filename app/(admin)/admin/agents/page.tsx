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
  const rows = await getAdminAgentsWithOrderStats()

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agents</h1>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No approved agents yet.</p>
      ) : (
        <AgentsAdminClient rows={rows} initialQuery={q ?? ""} />
      )}
    </div>
  )
}
