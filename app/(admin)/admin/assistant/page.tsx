import Link from "next/link"
import { requireAdmin } from "@/lib/admin/require-admin"
import { hasCmsPermission } from "@/lib/auth/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { AdminPageHeader } from "@/components/admin/admin-page-kit"
import { canSendWhatsAppReply, inboxWaitState, previewText, type InboxRow } from "@/lib/assistant/inbox"
import { mapAssistantSettings } from "@/lib/assistant/settings"
import { latestMessagePreviews } from "@/lib/assistant/store"
import { listMarketingOutreachForDeals } from "@/lib/integrations/marketing-leads/outreach-store"
import { ASSISTANT_KNOWLEDGE_HREF, ASSISTANT_READINESS_HREF } from "@/lib/assistant/types"
import { InboxWorkspace } from "./inbox-workspace"
import { AssistantSettingsForm } from "./settings-form"

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
  const [{ data: rows }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("assistant_conversations")
      .select(
        "id, channel, status, identity_status, display_name, phone_digits, email, deal_id, updated_at, last_client_message_at, last_outbound_at",
      )
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("assistant_settings").select("*").eq("id", "default").maybeSingle(),
  ])
  const settings = mapAssistantSettings(settingsRow)
  const conversations = rows ?? []
  const dealIds = conversations.map((row) => (row.deal_id ? String(row.deal_id) : "")).filter(Boolean)
  const [previews, outreach, dealsRes] = await Promise.all([
    admin
      ? latestMessagePreviews(
          admin,
          conversations.map((row) => String(row.id)),
        )
      : Promise.resolve(
          {} as Awaited<ReturnType<typeof latestMessagePreviews>>,
        ),
    dealIds.length > 0
      ? listMarketingOutreachForDeals(dealIds)
      : Promise.resolve({} as Awaited<ReturnType<typeof listMarketingOutreachForDeals>>),
    dealIds.length > 0
      ? supabase.from("deals").select("id, reference").in("id", dealIds)
      : Promise.resolve({ data: [] }),
  ])
  const dealRef = new Map((dealsRes.data ?? []).map((row) => [String(row.id), String(row.reference ?? "")]))

  const mapped: InboxRow[] = conversations.map((row) => {
    const wait = inboxWaitState({
      lastClientMessageAt: row.last_client_message_at ? String(row.last_client_message_at) : null,
      lastOutboundAt: row.last_outbound_at ? String(row.last_outbound_at) : null,
    })
    const preview = previews[String(row.id)]
    const dealId = row.deal_id ? String(row.deal_id) : null
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
      email: row.email ? String(row.email) : null,
      phone: row.phone_digits ? String(row.phone_digits) : null,
      dealId,
      dealReference: dealId ? dealRef.get(dealId) || null : null,
      outreachLabel: dealId ? outreach[dealId]?.label ?? null : null,
    }
  })

  const selectedRow = selectedId ? conversations.find((row) => String(row.id) === selectedId) : null
  const selectedMapped = selectedId ? mapped.find((row) => row.id === selectedId) ?? null : null
  let selected = null
  if (selectedRow && selectedMapped) {
    const [{ data: messages }, { data: drafts }] = await Promise.all([
      supabase
        .from("assistant_messages")
        .select("id, direction, sent_by, channel, body, media_type, created_at")
        .eq("conversation_id", selectedMapped.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("assistant_drafts")
        .select("id, body, status, intent")
        .eq("conversation_id", selectedMapped.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1),
    ])
    const draft = drafts?.[0] ?? null
    selected = {
      conversationId: selectedMapped.id,
      status: selectedMapped.status,
      channel: selectedMapped.channel,
      canSendWhatsApp: canSendWhatsAppReply(
        selectedRow.last_client_message_at ? String(selectedRow.last_client_message_at) : null,
      ),
      displayName: selectedMapped.name,
      email: selectedMapped.email,
      phone: selectedMapped.phone,
      dealId: selectedMapped.dealId,
      dealReference: selectedMapped.dealReference,
      outreachLabel: selectedMapped.outreachLabel,
      messages: (messages ?? []).map((row) => ({
        id: String(row.id),
        direction: String(row.direction),
        sentBy: String(row.sent_by),
        channel: String(row.channel || selectedMapped.channel),
        body: String(row.body ?? ""),
        mediaType: row.media_type ? String(row.media_type) : null,
        createdAt: String(row.created_at),
      })),
      draft: draft ? { id: String(draft.id), body: String(draft.body), intent: String(draft.intent) } : null,
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-3 sm:p-4">
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
      <InboxWorkspace rows={mapped} selectedId={selectedId ?? null} selected={selected} />
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
