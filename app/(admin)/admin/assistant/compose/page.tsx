import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"
import { openCmsComposer } from "@/lib/assistant/ingest"

export const dynamic = "force-dynamic"

export default async function AssistantComposePage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string }>
}) {
  await requireAdmin()
  const { deal } = await searchParams
  const dealId = deal?.trim() || ""
  if (!dealId) redirect("/admin/assistant")
  const conversation = await openCmsComposer(dealId)
  redirect(`/admin/assistant/${conversation.id}`)
}
