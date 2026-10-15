"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { channelLabel, inboxWaitLabel, type InboxWaitState } from "@/lib/assistant/inbox"

const FILTERS = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "replied", label: "They replied" },
  { id: "closed", label: "Closed" },
] as const

export function AssistantInboxClient({
  filter,
  rows,
}: {
  filter: string
  rows: Array<{
    id: string
    channel: string
    wait: InboxWaitState
    name: string
    preview: string
    updatedAt: string
  }>
}) {
  const router = useRouter()
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => router.push(item.id === "all" ? "/admin/assistant" : `/admin/assistant?view=${item.id}`)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium",
              filter === item.id ? "bg-red-50 text-primary" : "text-muted-foreground hover:bg-slate-50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-[#f0f1f3]">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/assistant/${row.id}`}
            className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-[#1b1c1f]">{row.name}</span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {channelLabel(row.channel)}
                </span>
              </span>
              <span className="mt-0.5 block text-[12px] text-[#4b5058]">{row.preview}</span>
              <span
                className={cn(
                  "mt-1 block text-[11px]",
                  row.wait === "replied" ? "font-medium text-emerald-700" : "text-[#80848d]",
                )}
              >
                {inboxWaitLabel(row.wait)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-[#9aa0a6]">
              {new Date(row.updatedAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </Link>
        ))}
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-[#9aa0a6]">
            No conversations here yet. Marketing follow-ups and customer replies land in this list.
          </p>
        ) : null}
      </div>
    </div>
  )
}
