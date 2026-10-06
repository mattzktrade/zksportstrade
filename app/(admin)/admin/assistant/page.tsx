import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { createClient } from "@/lib/supabase/server"
import { Inbox, MessagesSquare, PauseCircle } from "lucide-react"
import { AdminPageHeader, AdminStatCard, AdminStats } from "@/components/admin/admin-page-kit"
import { mapAssistantSettings } from "@/lib/assistant/settings"
import { ASSISTANT_KNOWLEDGE_HREF, ASSISTANT_READINESS_HREF, type AssistantStatus } from "@/lib/assistant/types"
import { AssistantInboxClient } from "./inbox-client"
import { AssistantSettingsForm } from "./settings-form"

export const dynamic = "force-dynamic"

const STATUSES: Array<AssistantStatus | "all"> = ["all", "needs_review", "ai_active", "human_takeover", "closed"]

export default async function AssistantInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const profile = await requireAdmin()
  const { status: statusParam } = await searchParams
  const status = STATUSES.includes(statusParam as AssistantStatus) ? (statusParam as AssistantStatus | "all") : "all"
  const supabase = await createClient()
  let query = supabase
    .from("assistant_conversations")
    .select("id, channel, status, identity_status, display_name, phone_digits, email, updated_at, last_client_message_at")
    .order("updated_at", { ascending: false })
    .limit(200)
  if (status !== "all") query = query.eq("status", status)
  const [{ data: rows }, { data: settingsRow }, { count: reviewCount }] = await Promise.all([
    query,
    supabase.from("assistant_settings").select("*").eq("id", "default").maybeSingle(),
    supabase.from("assistant_conversations").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
  ])
  const settings = mapAssistantSettings(settingsRow)

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Sales assistant"
        description="WhatsApp and email replies drafted from live stock, product copy, and the CRM. Auto-send only when it is sure."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href={ASSISTANT_READINESS_HREF}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium"
            >
              Knowledge checklist
            </Link>
            <Link
              href={ASSISTANT_KNOWLEDGE_HREF}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium"
            >
              Knowledge base
            </Link>
          </div>
        }
      />
      <AdminStats className="grid-cols-3">
        <AdminStatCard
          icon={Inbox}
          label="Needs review"
          value={String(reviewCount ?? 0)}
          tone="amber"
          href="/admin/assistant?status=needs_review"
        />
        <AdminStatCard
          icon={PauseCircle}
          label="Auto-send"
          value={settings.killSwitch ? "Paused" : settings.autoSendEnabled ? "On" : "Draft only"}
          tone={settings.autoSendEnabled && !settings.killSwitch ? "green" : "blue"}
        />
        <AdminStatCard icon={MessagesSquare} label="Open threads" value={String((rows ?? []).length)} tone="red" />
      </AdminStats>
      <AssistantInboxClient
        status={status}
        rows={(rows ?? []).map((row) => ({
          id: String(row.id),
          channel: String(row.channel),
          status: String(row.status),
          identity: String(row.identity_status),
          name: String(row.display_name || row.email || row.phone_digits || "Client"),
          updatedAt: String(row.updated_at),
        }))}
      />
      {hasCmsPermission(profile, "settings.manage") ? (
        <AssistantSettingsForm
          autoSendEnabled={settings.autoSendEnabled}
          killSwitch={settings.killSwitch}
          allowPublishedTradePrices={settings.allowPublishedTradePrices}
          notifyEmails={settings.notifyEmails.join(", ")}
          debounceSeconds={settings.debounceSeconds}
        />
      ) : null}
    </div>
  )
}
