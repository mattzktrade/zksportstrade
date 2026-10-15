import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { Inbox, MessagesSquare, Reply } from "lucide-react"
import { AdminPageHeader, AdminStatCard, AdminStats } from "@/components/admin/admin-page-kit"
import { inboxWaitState, previewText } from "@/lib/assistant/inbox"
import { mapAssistantSettings } from "@/lib/assistant/settings"
import { latestMessagePreviews } from "@/lib/assistant/store"
import { ASSISTANT_KNOWLEDGE_HREF, ASSISTANT_READINESS_HREF } from "@/lib/assistant/types"
import { AssistantInboxClient } from "./inbox-client"
import { AssistantSettingsForm } from "./settings-form"

export const dynamic = "force-dynamic"

const VIEWS = ["all", "waiting", "replied", "closed"] as const
type InboxView = (typeof VIEWS)[number]

export default async function AssistantInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string }>
}) {
  const profile = await requireAdmin()
  const { view: viewParam, status: statusParam } = await searchParams
  const view: InboxView = VIEWS.includes((viewParam || statusParam) as InboxView)
    ? ((viewParam || statusParam) as InboxView)
    : "all"
  const supabase = await createClient()
  const admin = createAdminClient()
  const [{ data: rows }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("assistant_conversations")
      .select(
        "id, channel, status, identity_status, display_name, phone_digits, email, updated_at, last_client_message_at, last_outbound_at",
      )
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("assistant_settings").select("*").eq("id", "default").maybeSingle(),
  ])
  const settings = mapAssistantSettings(settingsRow)
  const conversations = rows ?? []
  const previews = admin
    ? await latestMessagePreviews(
        admin,
        conversations.map((row) => String(row.id)),
      )
    : {}

  const mapped = conversations.map((row) => {
    const wait = inboxWaitState({
      lastClientMessageAt: row.last_client_message_at ? String(row.last_client_message_at) : null,
      lastOutboundAt: row.last_outbound_at ? String(row.last_outbound_at) : null,
    })
    const preview = previews[String(row.id)]
    return {
      id: String(row.id),
      channel: String(row.channel),
      status: String(row.status),
      wait,
      name: String(row.display_name || row.email || row.phone_digits || "Client"),
      preview: preview
        ? `${preview.direction === "outbound" ? "You: " : ""}${previewText(preview.body)}`
        : "No messages yet",
      updatedAt: String(row.updated_at),
    }
  })

  const filtered = mapped.filter((row) => {
    if (view === "all") return true
    if (view === "closed") return row.status === "closed"
    if (view === "waiting") return row.status !== "closed" && row.wait === "waiting"
    if (view === "replied") return row.status !== "closed" && row.wait === "replied"
    return true
  })

  const waitingCount = mapped.filter((row) => row.status !== "closed" && row.wait === "waiting").length
  const openReplied = mapped.filter((row) => row.status !== "closed" && row.wait === "replied").length

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Inbox"
        description="WhatsApp and email in one place. Sent follow-ups show here, and you reply from the thread."
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
        <AdminStatCard icon={Reply} label="Waiting for a reply" value={String(waitingCount)} tone="blue" href="/admin/assistant?view=waiting" />
        <AdminStatCard
          icon={Inbox}
          label="They replied"
          value={String(openReplied)}
          tone="amber"
          href="/admin/assistant?view=replied"
        />
        <AdminStatCard icon={MessagesSquare} label="Open threads" value={String(mapped.filter((row) => row.status !== "closed").length)} tone="red" />
      </AdminStats>
      <AssistantInboxClient filter={view} rows={filtered} />
      {hasCmsPermission(profile, "settings.manage") ? (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Assistant settings</summary>
          <div className="mt-3">
            <AssistantSettingsForm
              autoSendEnabled={settings.autoSendEnabled}
              killSwitch={settings.killSwitch}
              allowPublishedTradePrices={settings.allowPublishedTradePrices}
              notifyEmails={settings.notifyEmails.join(", ")}
              debounceSeconds={settings.debounceSeconds}
            />
          </div>
        </details>
      ) : null}
    </div>
  )
}
