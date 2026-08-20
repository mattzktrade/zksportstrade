import { redirect } from "next/navigation"

/** Salesforce runtime is retired. Keep this URL for old bookmarks. */
export default function SalesforceIntegrationPage() {
  redirect("/admin/settings?tab=integrations")
}
