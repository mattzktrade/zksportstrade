"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  channelLabel,
  formatInboxTime,
  inboxRowVisible,
  inboxWaitLabel,
  type InboxChannelFilter,
  type InboxRow,
  type InboxViewFilter,
} from "@/lib/assistant/inbox"
import { AssistantConversationClient } from "./conversation-client"

const VIEWS: Array<{ id: InboxViewFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "replied", label: "They replied" },
  { id: "waiting", label: "Waiting" },
  { id: "closed", label: "Done" },
]

const CHANNELS: Array<{ id: InboxChannelFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
]

export function InboxWorkspace({
  rows,
  selectedId,
  selected,
}: {
  rows: InboxRow[]
  selectedId: string | null
  selected: {
    conversationId: string
    status: string
    channel: string
    canSendWhatsApp: boolean
    displayName: string
    email: string | null
    phone: string | null
    dealId: string | null
    dealReference: string | null
    outreachLabel: string | null
    messages: Array<{
      id: string
      direction: string
      sentBy: string
      channel: string
      body: string
      mediaType: string | null
      createdAt: string
    }>
    draft: { id: string; body: string; intent: string } | null
  } | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [view, setView] = useState<InboxViewFilter>("all")
  const [channel, setChannel] = useState<InboxChannelFilter>("all")

  const visible = useMemo(
    () => rows.filter((row) => inboxRowVisible(row, { query, channel, view })),
    [rows, query, channel, view],
  )

  function openThread(id: string) {
    router.push(`/admin/assistant?c=${id}`)
  }

  return (
    <div className="grid min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <section className={cn("flex min-h-0 flex-col border-border lg:border-r", selectedId ? "hidden lg:flex" : "flex")}>
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, phone, message…"
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[12px] outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {CHANNELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setChannel(item.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium",
                  channel === item.id ? "bg-red-50 text-primary" : "text-muted-foreground hover:bg-slate-50",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium",
                  view === item.id ? "bg-slate-900 text-white" : "text-muted-foreground hover:bg-slate-50",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 divide-y divide-[#f0f1f3] overflow-y-auto">
          {visible.map((row) => {
            const needsYou = row.wait === "replied" && row.status !== "closed"
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => openThread(row.id)}
                className={cn(
                  "block w-full px-4 py-3 text-left hover:bg-slate-50",
                  selectedId === row.id ? "bg-red-50/60" : "",
                  needsYou ? "border-l-2 border-l-primary" : "",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className={cn("truncate text-[13px]", needsYou ? "font-semibold text-[#18191c]" : "font-medium text-[#1b1c1f]")}>
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#9aa0a6]">{formatInboxTime(row.updatedAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                    {channelLabel(row.channel)}
                  </span>
                  {row.dealReference ? (
                    <span className="truncate text-[10px] text-[#80848d]">{row.dealReference}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-[#4b5058]">{row.preview}</span>
                <span className={cn("mt-1 block text-[11px]", needsYou ? "font-medium text-emerald-700" : "text-[#80848d]")}>
                  {row.status === "closed" ? "Done" : inboxWaitLabel(row.wait)}
                </span>
              </button>
            )
          })}
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[#9aa0a6]">
              {rows.length === 0
                ? "No conversations yet. Follow-ups and replies will land here."
                : "Nothing matches that search or filter."}
            </p>
          ) : null}
        </div>
      </section>

      <section className={cn("flex min-h-0 flex-col", selectedId ? "flex" : "hidden lg:flex")}>
        {selected ? (
          <>
            <div className="border-b border-border px-3 py-2 lg:hidden">
              <Link href="/admin/assistant" className="text-[12px] font-medium text-primary">
                Back to inbox
              </Link>
            </div>
            <AssistantConversationClient {...selected} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-[#9aa0a6]">
            Pick a conversation to read the thread and reply.
          </div>
        )}
      </section>
    </div>
  )
}
