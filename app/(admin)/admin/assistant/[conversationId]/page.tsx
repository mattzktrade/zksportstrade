import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/require-admin"

export const dynamic = "force-dynamic"

export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  await requireAdmin()
  const { conversationId } = await params
  redirect(`/admin/assistant?c=${conversationId}`)
}
