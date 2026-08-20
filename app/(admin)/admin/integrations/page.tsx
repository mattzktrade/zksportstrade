import { redirect } from "next/navigation"

/** Integrations now live under Settings. Keep this URL working for old bookmarks. */
export default function IntegrationsHubPage() {
  redirect("/admin/settings?tab=integrations")
}
