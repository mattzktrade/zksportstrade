import { requireAdmin } from "@/lib/admin/require-admin"
import { HelpClient } from "./help-client"

export const dynamic = "force-dynamic"

export default async function AdminHelpPage() {
  await requireAdmin()
  return <HelpClient />
}
