import { requireCmsPermission } from "@/lib/admin/require-admin"
import { loadMcpAdminPage } from "@/lib/mcp/admin"
import { McpAdminClient } from "./mcp-client"

export const dynamic = "force-dynamic"

export default async function McpAdminPage() {
  await requireCmsPermission("settings.manage")
  const data = await loadMcpAdminPage()
  return <McpAdminClient data={data} />
}
