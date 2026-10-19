import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { inboxWaitState, previewText, type InboxRow } from "@/lib/assistant/inbox"
import { loadInboxThreadById } from "@/lib/assistant/inbox-load"
import { mapAssistantSettings } from "@/lib/assistant/settings"
import { latestMessagePreviews } from "@/lib/assistant/store"
import { listMarketingOutreachForDeals } from "@/lib/integrations/marketing-leads/outreach-store"
import { ASSISTANT_KNOWLEDGE_HREF, ASSISTANT_READINESS_HREF } from "@/lib/assistant/types"
import { isInboundEmailWebhookConfigured } from "@/lib/assistant/email-inbound-config"
import { InboxWorkspace } from "./inbox-workspace"
import { AssistantSettingsForm } from "./settings-form"
import { EmailRepliesSetup } from "./email-replies-setup"

export const dynamic = "force-dynamic"

export default async function AssistantInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const profile = await requireAdmin()
  const { c: selectedId } = await searchParams
  const supabase = await createClient()
  const admin = createAdminClient()
  const conversationSelect =
    "id, channel, status, identity_status, display_name, phone_digits, email, deal_id, updated_at, last_client_message_at, last_outbound_at"
  const [{ data: recentRows }, { data: repliedRows }, { data: settingsRow }] = await Promise.all([
    supabase.from("assistant_conversations").select(conversationSelect).order("updated_at", { ascending: false }).limit(500),
    supabase
      .from("assistant_conversations")
      .select(conversationSelect)
      .not("last_client_message_at", "is", null)
      .order("last_client_message_at", { ascending: false })
      .limit(300),
    supabase.from("assistant_settings").select("*").eq("id", "default").maybeSingle(),
  ])
  const settings = mapAssistantSettings(settingsRow)
  const conversations = [
    ...new Map(
      [...(repliedRows ?? []), ...(recentRows ?? [])].map((row) => [String(row.id), row]),
    ).values(),
  ].sort((left, right) => Date.parse(String(right.updated_at)) - Date.parse(String(left.updated_at)))
  const dealIds = conversations.map((row) => (row.deal_id ? String(row.deal_id) : "")).filter(Boolean)
  const repliedDealIds = conversations
    .filter((row) => row.last_client_message_at && row.deal_id)
    .map((row) => String(row.deal_id))
  const previewIds = [
    ...conversations.filter((row) => row.last_client_message_at).map((row) => String(row.id)),
    ...conversations.filter((row) => !row.last_client_message_at).slice(0, 80).map((row) => String(row.id)),
  ]
  const dealChunks: string[][] = []
  for (let i = 0; i < dealIds.length; i += 80) dealChunks.push(dealIds.slice(i, i + 80))
  const [previews, outreach, dealRows] = await Promise.all([
    admin
      ? latestMessagePreviews(admin, previewIds)
      : Promise.resolve({} as Awaited<ReturnType<typeof latestMessagePreviews>>),
    repliedDealIds.length > 0
      ? listMarketingOutreachForDeals(repliedDealIds)
      : Promise.resolve({} as Awaited<ReturnType<typeof listMarketingOutreachForDeals>>),
    dealChunks.length > 0
      ? Promise.all(dealChunks.map((chunk) => supabase.from("deals").select("id, reference").in("id", chunk))).then(
          (results) => results.flatMap((result) => result.data ?? []),
        )
      : Promise.resolve([] as Array<{ id: string; reference: string | null }>),
  ])
  const dealRef = new Map(dealRows.map((row) => [String(row.id), String(row.reference ?? "")]))

  const mapped: InboxRow[] = conversations.map((row) => {
    const lastClientMessageAt = row.last_client_message_at ? String(row.last_client_message_at) : null
    const wait = inboxWaitState({
      lastClientMessageAt,
      lastOutboundAt: row.last_outbound_at ? String(row.last_outbound_at) : null,
    })
    const preview = previews[String(row.id)]
    const dealId = row.deal_id ? String(row.deal_id) : null
    return {
      id: String(row.id),
      channel: String(row.channel),
      status: String(row.status),
      wait,
      hasClientReply: Boolean(lastClientMessageAt),
      lastClientMessageAt,
      name: String(row.display_name || row.email || row.phone_digits || "Client"),
      preview: preview
        ? `${preview.direction === "outbound" ? "You: " : ""}${previewText(preview.body)}`
        : "No messages yet",
      updatedAt: String(row.updated_at),
      email: row.email ? String(row.email) : null,
      phone: row.phone_digits ? String(row.phone_digits) : null,
      dealId,
      dealReference: dealId ? dealRef.get(dealId) || null : null,
      outreachLabel: dealId ? outreach[dealId]?.label ?? null : null,
    }
  })

  const selectedMapped = selectedId ? mapped.find((row) => row.id === selectedId) ?? null : null
  const selectedLoaded = selectedId ? await loadInboxThreadById(selectedId) : null
  const selected = selectedLoaded
    ? {
        ...selectedLoaded,
        displayName: selectedMapped?.name || selectedLoaded.displayName,
        email: selectedMapped?.email ?? selectedLoaded.email,
        phone: selectedMapped?.phone ?? selectedLoaded.phone,
        dealId: selectedMapped?.dealId ?? selectedLoaded.dealId,
        dealReference: selectedMapped?.dealReference ?? selectedLoaded.dealReference,
        outreachLabel: selectedMapped?.outreachLabel ?? selectedLoaded.outreachLabel,
      }
    : null

  return (
    <InboxWorkspace
      rows={mapped}
      selectedId={selectedId ?? null}
      selected={selected}
      header={
        <AdminPageHeader
          title="Inbox"
          description="Search and reply to WhatsApp and email. Draft with AI, then send when it looks right."
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
      }
      footer={
        <>
          <EmailRepliesSetup configured={isInboundEmailWebhookConfigured()} />
          {hasCmsPermission(profile, "settings.manage") ? (
            <details className="min-w-0 rounded-xl border border-border bg-card p-3">
              <summary className="cursor-pointer break-words text-sm font-semibold text-foreground">
                Assistant settings
              </summary>
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
        </>
      }
    />
  )
}
