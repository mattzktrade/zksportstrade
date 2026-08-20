import { requireAdmin } from "@/lib/admin/require-admin"
import { getCutoverWorkspace } from "@/lib/admin/cutover"
import { CutoverClient } from "./cutover-client"

export const dynamic = "force-dynamic"

export default async function CutoverPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>
}) {
  const profile = await requireAdmin()
  if (profile.role !== "admin") {
    return (
      <div className="p-8 text-sm text-slate-500">
        Controlled cutover is restricted to administrators.
      </div>
    )
  }
  const { run } = await searchParams
  const workspace = await getCutoverWorkspace(run)
  return <CutoverClient {...workspace} />
}

