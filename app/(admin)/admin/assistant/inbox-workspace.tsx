"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  channelLabel,
  formatInboxTime,
  inboxRowVisible,
  inboxStatusLabel,
  inboxThreadStub,
  mergeInboxThread,
  previewText,
  type InboxChannelFilter,
  type InboxRow,
  type InboxThread,
  type InboxViewFilter,
} from "@/lib/assistant/inbox"
import { toast } from "sonner"
import { AssistantConversationClient } from "./conversation-client"

async function fetchInboxThread(id: string): Promise<InboxThread> {
  const response = await fetch(`/api/admin/assistant/conversations/${id}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; thread?: InboxThread; error?: string }
    | null
  if (!response.ok || !payload?.thread) {
    throw new Error(payload?.error || "Could not load this conversation.")
  }
  return payload.thread
}

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

function inboxUrl(id: string | null): string {
  return id ? `/admin/assistant?c=${id}` : "/admin/assistant"
}

const InboxListRow = memo(function InboxListRow({
  row,
  selected,
  onOpen,
  onPrefetch,
}: {
  row: InboxRow
  selected: boolean
  onOpen: (id: string) => void
  onPrefetch: (id: string) => void
}) {
  const needsYou = row.wait === "replied" && row.status !== "closed"
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      onPointerEnter={(event) => {
        const timer = window.setTimeout(() => onPrefetch(row.id), 140)
        event.currentTarget.dataset.prefetchTimer = String(timer)
      }}
      onPointerLeave={(event) => {
        const timer = Number(event.currentTarget.dataset.prefetchTimer)
        if (timer) window.clearTimeout(timer)
      }}
      className={cn(
        "block w-full px-4 py-3 text-left [content-visibility:auto] [contain-intrinsic-size:0_96px] hover:bg-slate-50",
        selected ? "bg-red-50/60" : "",
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
        {row.dealReference ? <span className="truncate text-[10px] text-[#80848d]">{row.dealReference}</span> : null}
      </span>
      <span className="mt-0.5 block truncate text-[12px] text-[#4b5058]">{row.preview}</span>
      <span className={cn("mt-1 block text-[11px]", needsYou ? "font-medium text-emerald-700" : "text-[#80848d]")}>
        {inboxStatusLabel(row)}
      </span>
    </button>
  )
})

export function InboxWorkspace({
  rows: initialRows,
  selectedId: initialSelectedId,
  selected: initialThread,
  header,
  footer,
}: {
  rows: InboxRow[]
  selectedId: string | null
  selected: InboxThread | null
  header?: ReactNode
  footer?: ReactNode
}) {
  const [query, setQuery] = useState("")
  const [view, setView] = useState<InboxViewFilter>("all")
  const [channel, setChannel] = useState<InboxChannelFilter>("all")
  const [rows, setRows] = useState(initialRows)
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [thread, setThread] = useState<InboxThread | null>(initialThread)
  const [loading, setLoading] = useState(false)
  const cacheRef = useRef(new Map<string, InboxThread>(initialThread ? [[initialThread.conversationId, initialThread]] : []))
  const requestRef = useRef(0)
  const prefetchRef = useRef(new Set<string>())
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    setRows(initialRows)
  }, [initialRows])

  const visible = useMemo(
    () => rows.filter((row) => inboxRowVisible(row, { query, channel, view })),
    [rows, query, channel, view],
  )

  const loadThread = useCallback(async (id: string, force = false) => {
    const request = ++requestRef.current
    const row = rowsRef.current.find((item) => item.id === id)
    const cached = cacheRef.current.get(id)
    if (cached && !force) {
      setThread(row ? mergeInboxThread(row, cached) : cached)
      setLoading(false)
    } else if (row) {
      setThread(inboxThreadStub(row))
      setLoading(true)
    } else {
      setLoading(true)
    }
    try {
      const loaded = await fetchInboxThread(id)
      if (request !== requestRef.current) return
      const latestRow = rowsRef.current.find((item) => item.id === id)
      const next = latestRow ? mergeInboxThread(latestRow, loaded) : loaded
      cacheRef.current.set(id, next)
      setThread(next)
      const last = next.messages[next.messages.length - 1]
      const lastPreview = last
        ? last.body || last.mediaFilename || (last.mediaType ? `(${last.mediaType})` : "")
        : ""
      setRows((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: next.status,
                preview: last
                  ? `${last.direction === "outbound" ? "You: " : ""}${previewText(lastPreview)}`
                  : item.preview,
              }
            : item,
        ),
      )
    } catch (error) {
      if (request !== requestRef.current) return
      toast.error(error instanceof Error ? error.message : "Could not load this conversation.")
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    function onPopState() {
      const nextId = new URLSearchParams(window.location.search).get("c")
      setSelectedId(nextId)
      if (nextId) void loadThread(nextId)
      else setThread(null)
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [loadThread])

  const openThread = useCallback(
    (id: string) => {
      const cached = cacheRef.current.get(id)
      if (id === selectedId && thread && (cached || thread.messages.length > 0) && !loading) return
      setSelectedId(id)
      const row = rowsRef.current.find((item) => item.id === id)
      setThread(cached ? (row ? mergeInboxThread(row, cached) : cached) : row ? inboxThreadStub(row) : null)
      setLoading(!cached)
      if (window.location.search !== `?c=${id}`) {
        window.history.replaceState({ c: id }, "", inboxUrl(id))
      }
      void loadThread(id, !cached)
    },
    [loadThread, loading, selectedId, thread],
  )

  const prefetchThread = useCallback((id: string) => {
    if (prefetchRef.current.has(id) || cacheRef.current.has(id)) return
    prefetchRef.current.add(id)
    void fetchInboxThread(id)
      .then((loaded) => {
        cacheRef.current.set(id, loaded)
      })
      .catch(() => {
        prefetchRef.current.delete(id)
      })
  }, [])

  useEffect(() => {
    if (initialSelectedId && (!initialThread || initialThread.messages.length === 0)) {
      void loadThread(initialSelectedId, true)
    }
  }, [initialSelectedId, initialThread, loadThread])

  function closeList() {
    setSelectedId(null)
    setThread(null)
    window.history.replaceState({ c: null }, "", inboxUrl(null))
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top,0px))] flex-col overflow-hidden p-3 sm:h-[calc(100dvh-4rem-env(safe-area-inset-top,0px))] sm:p-4">
      {header ? <div className={cn("mb-3 shrink-0", selectedId && "hidden lg:block")}>{header}</div> : null}
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <section
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden border-border lg:border-r",
            selectedId ? "hidden lg:flex" : "flex",
          )}
        >
          <div className="shrink-0 space-y-2 border-b border-border p-3">
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
            {visible.map((row) => (
              <InboxListRow
                key={row.id}
                row={row}
                selected={selectedId === row.id}
                onOpen={openThread}
                onPrefetch={prefetchThread}
              />
            ))}
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-[#9aa0a6]">
                {rows.length === 0
                  ? "No conversations yet. Follow-ups and replies will land here."
                  : "Nothing matches that search or filter."}
              </p>
            ) : null}
          </div>
          {footer ? (
            <div className="max-h-[38%] shrink-0 space-y-2 overflow-y-auto overflow-x-hidden border-t border-border p-3">
              {footer}
            </div>
          ) : null}
        </section>

        <section
          className={cn("min-h-0 min-w-0 flex-col overflow-hidden", selectedId ? "flex" : "hidden lg:flex")}
        >
          {thread ? (
            <>
              <div className="shrink-0 border-b border-border px-3 py-2 lg:hidden">
                <button type="button" className="text-[12px] font-medium text-primary" onClick={closeList}>
                  Back to inbox
                </button>
              </div>
              <AssistantConversationClient
                {...thread}
                loading={loading && thread.messages.length === 0}
                onChanged={() => void loadThread(thread.conversationId, true)}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-[#9aa0a6]">
              Pick a conversation to read the thread and reply.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
